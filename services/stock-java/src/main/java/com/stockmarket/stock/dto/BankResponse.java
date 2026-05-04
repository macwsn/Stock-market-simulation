package com.stockmarket.stock.dto;

import java.util.List;

public record BankResponse(List<StockEntry> stocks) {}
