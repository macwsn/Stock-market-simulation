package com.stockmarket.stock.dto;

public record AuditEntry(String type, String walletId, String stockName) {}
