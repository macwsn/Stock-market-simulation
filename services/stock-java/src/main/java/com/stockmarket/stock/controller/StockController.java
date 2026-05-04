package com.stockmarket.stock.controller;

import com.stockmarket.stock.dto.BankResponse;
import com.stockmarket.stock.dto.OperationRequest;
import com.stockmarket.stock.dto.WalletResponse;
import com.stockmarket.stock.service.StockService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class StockController {

    private final StockService service;

    public StockController(StockService service) {
        this.service = service;
    }

    @PostMapping("/wallets/{walletId}/stocks/{stockName}")
    public ResponseEntity<Void> operate(
            @PathVariable("walletId") String walletId,
            @PathVariable("stockName") String stockName,
            @RequestBody OperationRequest body
    ) {
        service.operate(walletId, stockName, body == null ? null : body.type());
        return ResponseEntity.ok().build();
    }

    @GetMapping("/wallets/{walletId}")
    public WalletResponse getWallet(@PathVariable("walletId") String walletId) {
        return service.getWallet(walletId);
    }

    @GetMapping("/wallets/{walletId}/stocks/{stockName}")
    public long getWalletStock(
            @PathVariable("walletId") String walletId,
            @PathVariable("stockName") String stockName
    ) {
        return service.getWalletStockQuantity(walletId, stockName);
    }

    @GetMapping("/stocks")
    public BankResponse getBank() {
        return service.getBank();
    }

    @PostMapping("/stocks")
    public ResponseEntity<Void> setBank(@RequestBody BankResponse body) {
        service.setBank(body == null ? null : body.stocks());
        return ResponseEntity.ok().build();
    }

    @GetMapping("/healthz")
    public ResponseEntity<Void> health() {
        return ResponseEntity.ok().build();
    }

    @PostMapping("/chaos")
    public ResponseEntity<Void> chaos() {
        // Schedule self-destruction after the response has had time to flush.
        Thread killer = new Thread(() -> {
            try { Thread.sleep(150); } catch (InterruptedException ignored) {}
            Runtime.getRuntime().halt(0);
        }, "chaos-killer");
        killer.setDaemon(false);
        killer.start();
        return ResponseEntity.ok().build();
    }
}
