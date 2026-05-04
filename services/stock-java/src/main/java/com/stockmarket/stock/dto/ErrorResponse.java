package com.stockmarket.stock.dto;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;

import java.time.Instant;

public record ErrorResponse(
        String error,
        int status,
        String path,
        String requestId,
        String timestamp
) {
    public static ErrorResponse of(HttpStatus httpStatus, String message, HttpServletRequest req) {
        return new ErrorResponse(
                message,
                httpStatus.value(),
                req.getRequestURI(),
                requestId(req),
                Instant.now().toString()
        );
    }

    private static String requestId(HttpServletRequest req) {
        Object attr = req.getAttribute("X-Request-ID");
        if (attr instanceof String s) return s;
        String header = req.getHeader("X-Request-ID");
        return header != null ? header : "n/a";
    }
}
