package com.stockmarket.stock.service;

import com.stockmarket.stock.dto.BankResponse;
import com.stockmarket.stock.dto.StockEntry;
import com.stockmarket.stock.dto.WalletResponse;
import com.stockmarket.stock.exception.ApiException;
import com.stockmarket.stock.repository.StockRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class StockService {

    private final StockRepository repo;

    public StockService(StockRepository repo) {
        this.repo = repo;
    }

    /**
     * Transactional buy/sell in a single Postgres transaction.
     *
     * timeout = 10 s: under extreme DB load, a long-running transaction
     * holding a row lock would starve other requests. Rolling back after 10 s
     * releases the lock and surfaces a 503 to the client instead of an
     * indefinite hang.
     *
     * isolation = READ_COMMITTED (Postgres default): the SELECT … FOR UPDATE
     * on bank_stocks already serialises writes per stock; a higher isolation
     * level would add unnecessary overhead.
     */
    @Transactional(isolation = Isolation.READ_COMMITTED, timeout = 10)
    public void operate(String walletId, String stockName, String type) {
        if (type == null || (!type.equals("buy") && !type.equals("sell"))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "type must be 'buy' or 'sell'");
        }

        if (repo.lockBankStock(stockName).isEmpty()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "stock not found");
        }

        repo.upsertWallet(walletId);

        if (type.equals("buy")) {
            int updated = repo.decrementBankStock(stockName);
            if (updated == 0) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "no stock available in bank");
            }
            repo.incrementWalletStock(walletId, stockName);
        } else {
            int updated = repo.decrementWalletStock(walletId, stockName);
            if (updated == 0) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "no stock in wallet");
            }
            repo.incrementBankStock(stockName);
        }

        repo.appendAudit(type, walletId, stockName);
    }

    @Transactional(readOnly = true, timeout = 5)
    public WalletResponse getWallet(String walletId) {
        if (!repo.walletExists(walletId)) {
            throw new ApiException(HttpStatus.NOT_FOUND, "wallet not found");
        }
        return new WalletResponse(walletId, repo.listWalletStocks(walletId));
    }

    @Transactional(readOnly = true, timeout = 5)
    public long getWalletStockQuantity(String walletId, String stockName) {
        return repo.getWalletStockQuantity(walletId, stockName);
    }

    @Transactional(readOnly = true, timeout = 5)
    public BankResponse getBank() {
        return new BankResponse(repo.listBank());
    }

    @Transactional(timeout = 10)
    public void setBank(List<StockEntry> stocks) {
        if (stocks == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "stocks required");
        }
        for (StockEntry e : stocks) {
            if (e.name() == null || e.name().isBlank()) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "stock name required");
            }
            if (e.quantity() < 0) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "quantity must be >= 0");
            }
        }
        repo.replaceBank(stocks);
    }
}
