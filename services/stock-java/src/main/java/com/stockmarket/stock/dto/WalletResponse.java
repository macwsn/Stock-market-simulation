package com.stockmarket.stock.dto;

import java.util.List;

public record WalletResponse(String id, List<StockEntry> stocks) {}
