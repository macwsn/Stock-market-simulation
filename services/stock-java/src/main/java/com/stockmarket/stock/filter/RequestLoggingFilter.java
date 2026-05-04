package com.stockmarket.stock.filter;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.UUID;

/**
 * Assigns a correlation ID to every request (reads X-Request-ID header or
 * generates a new one), echoes it in the response, stores it as a request
 * attribute so the exception handler can include it in error bodies, and
 * logs method + path + status + latency for every non-health request.
 */
@Component
@Order(1)
public class RequestLoggingFilter implements Filter {

    private static final Logger log = LoggerFactory.getLogger(RequestLoggingFilter.class);
    private static final String REQUEST_ID = "X-Request-ID";

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        var request  = (HttpServletRequest)  req;
        var response = (HttpServletResponse) res;

        String requestId = request.getHeader(REQUEST_ID);
        if (requestId == null || requestId.isBlank()) {
            requestId = UUID.randomUUID().toString().substring(0, 8);
        }

        request.setAttribute(REQUEST_ID, requestId);
        response.setHeader(REQUEST_ID, requestId);

        long start = System.currentTimeMillis();
        try {
            chain.doFilter(req, res);
        } finally {
            // Skip noisy health probes from HAProxy.
            if (!"/healthz".equals(request.getRequestURI())) {
                log.info("{} {} → {} ({}ms) reqId={}",
                        request.getMethod(),
                        request.getRequestURI(),
                        response.getStatus(),
                        System.currentTimeMillis() - start,
                        requestId);
            }
        }
    }
}
