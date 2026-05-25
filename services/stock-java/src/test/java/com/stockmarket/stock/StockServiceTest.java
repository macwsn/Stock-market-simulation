package com.stockmarket.stock;

import com.stockmarket.stock.dto.StockEntry;
import com.stockmarket.stock.exception.ApiException;
import com.stockmarket.stock.repository.StockRepository;
import com.stockmarket.stock.service.StockService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.HttpStatus;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
@Testcontainers
class StockServiceTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
            .withInitScript("schema.sql");

    @Autowired StockService service;
    @Autowired StockRepository repo;

    @BeforeEach
    void reset() {
        repo.replaceBank(List.of());
    }

    // --- buy ---

    @Test
    void buy_createsWalletAndMovesStock() {
        service.setBank(List.of(new StockEntry("AAPL", 10)));
        service.operate("alice", "AAPL", "buy");

        assertThat(service.getWalletStockQuantity("alice", "AAPL")).isEqualTo(1);
        assertThat(service.getBank().stocks())
                .containsExactly(new StockEntry("AAPL", 9));
    }

    @Test
    void buy_returns404_whenStockNotInBank() {
        assertThatThrownBy(() -> service.operate("alice", "UNKNOWN", "buy"))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).status())
                .isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void buy_returns400_whenBankHasZero() {
        service.setBank(List.of(new StockEntry("AAPL", 0)));

        assertThatThrownBy(() -> service.operate("alice", "AAPL", "buy"))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).status())
                .isEqualTo(HttpStatus.BAD_REQUEST);
    }

    // --- sell ---

    @Test
    void sell_movesStockBackToBank() {
        service.setBank(List.of(new StockEntry("AAPL", 10)));
        service.operate("alice", "AAPL", "buy");
        service.operate("alice", "AAPL", "sell");

        assertThat(service.getWalletStockQuantity("alice", "AAPL")).isEqualTo(0);
        assertThat(service.getBank().stocks())
                .containsExactly(new StockEntry("AAPL", 10));
    }

    @Test
    void sell_returns400_whenWalletHasNone() {
        service.setBank(List.of(new StockEntry("AAPL", 5)));

        assertThatThrownBy(() -> service.operate("alice", "AAPL", "sell"))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).status())
                .isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    void sell_returns404_whenStockNotInBank() {
        assertThatThrownBy(() -> service.operate("alice", "NOPE", "sell"))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).status())
                .isEqualTo(HttpStatus.NOT_FOUND);
    }

    // --- audit log ---

    @Test
    void operate_appendsAuditLogOnlyForSuccessfulOperations() {
        service.setBank(List.of(new StockEntry("AAPL", 5)));
        service.operate("alice", "AAPL", "buy");

        try { service.operate("alice", "UNKNOWN", "buy"); } catch (ApiException ignored) {}

        service.operate("alice", "AAPL", "sell");

        var log = repo.getAuditLog();
        assertThat(log).hasSize(2);
        assertThat(log.get(0).type()).isEqualTo("buy");
        assertThat(log.get(1).type()).isEqualTo("sell");
    }

    // --- bank ---

    @Test
    void setBank_replacesEntireState() {
        service.setBank(List.of(new StockEntry("AAPL", 100)));
        service.setBank(List.of(new StockEntry("GOOG", 50)));

        var stocks = service.getBank().stocks();
        assertThat(stocks).hasSize(1);
        assertThat(stocks.get(0).name()).isEqualTo("GOOG");
    }

    @Test
    void setBank_returns400_forNegativeQuantity() {
        assertThatThrownBy(() -> service.setBank(List.of(new StockEntry("AAPL", -1))))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).status())
                .isEqualTo(HttpStatus.BAD_REQUEST);
    }

    // --- concurrency invariant ---

    @Test
    void concurrentBuys_neverOversell() throws InterruptedException {
        int total = 50;
        service.setBank(List.of(new StockEntry("CONC", total)));

        int threads = 100;
        var latch   = new CountDownLatch(1);
        var ok      = new AtomicInteger();
        var bad     = new AtomicInteger();

        try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
            for (int i = 0; i < threads; i++) {
                final String walletId = "w" + (i % 5);
                pool.submit(() -> {
                    try {
                        latch.await();
                        service.operate(walletId, "CONC", "buy");
                        ok.incrementAndGet();
                    } catch (ApiException e) {
                        if (e.status() == HttpStatus.BAD_REQUEST) bad.incrementAndGet();
                    } catch (InterruptedException ignored) {}
                });
            }
            latch.countDown();
        }

        assertThat(ok.get()).isEqualTo(total);
        assertThat(bad.get()).isEqualTo(threads - total);

        long bankQty = service.getBank().stocks().stream()
                .filter(s -> s.name().equals("CONC"))
                .mapToLong(StockEntry::quantity)
                .sum();
        assertThat(bankQty).isZero();
    }
}
