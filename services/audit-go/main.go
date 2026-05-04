package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
)

type LogEntry struct {
	Type      string `json:"type"`
	WalletID  string `json:"wallet_id"`
	StockName string `json:"stock_name"`
}

type LogResponse struct {
	Log []LogEntry `json:"log"`
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		slog.Error("DATABASE_URL is required")
		os.Exit(1)
	}
	port := os.Getenv("SERVER_PORT")
	if port == "" {
		port = "8082"
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool, err := buildPool(ctx, dsn)
	if err != nil {
		slog.Error("postgres connect failed", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(requestLogger)

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		pingCtx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := pool.Ping(pingCtx); err != nil {
			http.Error(w, "db unreachable", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})

	r.Get("/log", func(w http.ResponseWriter, r *http.Request) {
		queryCtx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		rows, err := pool.Query(queryCtx,
			`SELECT type, wallet_id, stock_name FROM audit_log ORDER BY seq ASC`)
		if err != nil {
			slog.Error("audit log query failed", "err", err)
			http.Error(w, "query failed", http.StatusServiceUnavailable)
			return
		}
		defer rows.Close()

		entries := make([]LogEntry, 0, 64)
		for rows.Next() {
			var e LogEntry
			if err := rows.Scan(&e.Type, &e.WalletID, &e.StockName); err != nil {
				slog.Error("row scan failed", "err", err)
				http.Error(w, "scan failed", http.StatusInternalServerError)
				return
			}
			entries = append(entries, e)
		}
		if err := rows.Err(); err != nil {
			slog.Error("rows iteration error", "err", err)
			http.Error(w, "iteration failed", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(LogResponse{Log: entries}); err != nil {
			slog.Error("encode failed", "err", err)
		}
	})

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		slog.Info("audit service starting", "port", port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	slog.Info("shutting down")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	_ = srv.Shutdown(shutdownCtx)
}

// buildPool connects to Postgres with retry, bounded pool, and health checks.
func buildPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}

	cfg.MaxConns = 10
	cfg.MinConns = 2
	cfg.MaxConnLifetime = 5 * time.Minute
	cfg.MaxConnIdleTime = 2 * time.Minute
	cfg.HealthCheckPeriod = 30 * time.Second

	var (
		pool    *pgxpool.Pool
		lastErr error
	)
	for i := range 30 {
		pool, err = pgxpool.NewWithConfig(ctx, cfg)
		if err == nil {
			pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
			err = pool.Ping(pingCtx)
			cancel()
			if err == nil {
				return pool, nil
			}
			pool.Close()
		}
		lastErr = err
		slog.Warn("postgres not ready, retrying", "attempt", i+1, "err", err)
		time.Sleep(time.Second)
	}
	return nil, lastErr
}

// requestLogger logs method, path, status, and latency for every non-health request.
func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			next.ServeHTTP(w, r)
			return
		}
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		start := time.Now()
		next.ServeHTTP(ww, r)
		slog.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", ww.Status(),
			"ms", time.Since(start).Milliseconds(),
			"reqId", r.Header.Get("X-Request-ID"),
		)
	})
}
