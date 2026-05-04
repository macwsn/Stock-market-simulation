package com.stockmarket.stock.repository;

import com.stockmarket.stock.dto.AuditEntry;
import com.stockmarket.stock.dto.StockEntry;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public class StockRepository {

    private final JdbcTemplate jdbc;

    public StockRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Long> lockBankStock(String name) {
        return jdbc.query(
                "SELECT quantity FROM bank_stocks WHERE name = ? FOR UPDATE",
                (rs, i) -> rs.getLong(1),
                name
        ).stream().findFirst();
    }

    public void upsertWallet(String walletId) {
        jdbc.update(
                "INSERT INTO wallets(id) VALUES (?) ON CONFLICT (id) DO NOTHING",
                walletId
        );
    }

    public boolean walletExists(String walletId) {
        Integer c = jdbc.query(
                "SELECT 1 FROM wallets WHERE id = ?",
                (rs, i) -> rs.getInt(1),
                walletId
        ).stream().findFirst().orElse(null);
        return c != null;
    }

    public int decrementBankStock(String name) {
        return jdbc.update(
                "UPDATE bank_stocks SET quantity = quantity - 1 WHERE name = ? AND quantity > 0",
                name
        );
    }

    public void incrementBankStock(String name) {
        jdbc.update(
                "UPDATE bank_stocks SET quantity = quantity + 1 WHERE name = ?",
                name
        );
    }

    public int decrementWalletStock(String walletId, String stockName) {
        return jdbc.update(
                "UPDATE wallet_stocks SET quantity = quantity - 1 " +
                        "WHERE wallet_id = ? AND stock_name = ? AND quantity > 0",
                walletId, stockName
        );
    }

    public void incrementWalletStock(String walletId, String stockName) {
        jdbc.update(
                "INSERT INTO wallet_stocks(wallet_id, stock_name, quantity) VALUES (?, ?, 1) " +
                        "ON CONFLICT (wallet_id, stock_name) DO UPDATE " +
                        "SET quantity = wallet_stocks.quantity + 1",
                walletId, stockName
        );
    }

    public void appendAudit(String type, String walletId, String stockName) {
        jdbc.update(
                "INSERT INTO audit_log(type, wallet_id, stock_name) VALUES (?, ?, ?)",
                type, walletId, stockName
        );
    }

    public List<StockEntry> listBank() {
        return jdbc.query(
                "SELECT name, quantity FROM bank_stocks ORDER BY name",
                (rs, i) -> new StockEntry(rs.getString(1), rs.getLong(2))
        );
    }

    public List<StockEntry> listWalletStocks(String walletId) {
        return jdbc.query(
                "SELECT stock_name, quantity FROM wallet_stocks WHERE wallet_id = ? ORDER BY stock_name",
                (rs, i) -> new StockEntry(rs.getString(1), rs.getLong(2)),
                walletId
        );
    }

    public long getWalletStockQuantity(String walletId, String stockName) {
        return jdbc.query(
                "SELECT quantity FROM wallet_stocks WHERE wallet_id = ? AND stock_name = ?",
                (rs, i) -> rs.getLong(1),
                walletId, stockName
        ).stream().findFirst().orElse(0L);
    }

    public void replaceBank(List<StockEntry> stocks) {
        jdbc.update("DELETE FROM bank_stocks");
        for (StockEntry e : stocks) {
            jdbc.update(
                    "INSERT INTO bank_stocks(name, quantity) VALUES (?, ?)",
                    e.name(), e.quantity()
            );
        }
    }

    public List<AuditEntry> getAuditLog() {
        return jdbc.query(
                "SELECT type, wallet_id, stock_name FROM audit_log ORDER BY seq ASC",
                (rs, i) -> new AuditEntry(rs.getString(1), rs.getString(2), rs.getString(3))
        );
    }
}
