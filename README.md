# Stock Market Simulation

A polyglot, highly-available implementation of a simplified stock exchange built with Java, Go, and TypeScript.

```
            ┌──────────┐
client ─►   │ HAProxy  │   :PORT          (the only exposed port)
            └────┬─────┘
                 │
                 ├─► /          ──────► React frontend (Nginx)
                 ├─► /log ────────────► Go Audit Service ×2  (read-only)
                 │
                 └─► /stocks /wallets
                     /chaos ──────────► Java Stock Service ×3
                                          │
                                          ▼
                                     PostgreSQL  (single source of truth)
```

* **Java (Spring Boot 3, Java 21)** — core business logic: wallets, bank, buy/sell, `POST /chaos`. Three replicas, all stateless. Java 21 virtual threads are enabled so each HTTP request runs on a lightweight virtual thread — thousands of concurrent requests park cheaply on JDBC calls without exhausting a platform thread pool. Per-stock writes are serialised through a Postgres row lock so concurrent buys can never oversell.
* **Go (chi + pgx)** — owns `GET /log`. Two replicas, read-only. Uses `pgxpool` with bounded connection limits and a 5-second per-query context timeout so a slow DB never hangs a replica indefinitely.
* **React + TypeScript (Vite + Nginx)** — a minimalist browser UI served on `/`, giving a live view of the bank state, wallet lookup, buy/sell form, the full audit log (auto-refreshed every 5 s), and a one-click Chaos button.
* **HAProxy 2.9** — single ingress on the user-supplied port, path-based routing, 1 s health checks, automatic retry / redispatch on backend failure.
* **PostgreSQL 16** — shared state. The schema is created from `infra/postgres/init.sql` on first container start.
* **TypeScript (Jest + axios)** — black-box end-to-end suite covering the contract, concurrency invariants, and chaos / HA behaviour.

## Quick start

Requires only **Docker** (with `docker compose`). Java / Go / Node runtimes are not needed on the host — everything builds inside containers.

### macOS / Linux

```bash
./run.sh 8080
```

### Windows (PowerShell)

```powershell
.\run.ps1 8080
```

The argument is the port the API will be exposed on. The script blocks until the API answers `GET /healthz` and `GET /stocks`, then prints `Ready`. Total cold build is ~2 min on first run (Gradle + Go module fetch); subsequent runs take seconds because layers are cached.

To stop everything:

```bash
docker compose down
```

Open `http://localhost:8080` in a browser to use the UI.

## API

All endpoints are served from `http://localhost:<PORT>`.

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/wallets/{wallet_id}/stocks/{stock_name}` | Body `{"type":"buy"|"sell"}`. Auto-creates the wallet on first call. |
| `GET`  | `/wallets/{wallet_id}` | Full wallet state: id + list of held stocks with quantities. |
| `GET`  | `/wallets/{wallet_id}/stocks/{stock_name}` | Single integer — quantity of that stock in the wallet. |
| `GET`  | `/stocks` | Current bank state: list of all stocks with quantities. |
| `POST` | `/stocks` | Body `{"stocks":[{"name":…,"quantity":…},…]}`. Fully replaces bank state. |
| `GET`  | `/log` | Full audit log of successful wallet operations in order of occurrence. |
| `POST` | `/chaos` | Kills the Java backend instance that handled the request. |

### Status codes

| Code | Meaning |
| ---- | ------- |
| `200` | Success. |
| `400` | `buy` with 0 bank stock, `sell` with 0 wallet stock, or malformed body. |
| `404` | Stock name not registered in the bank; or wallet not found (on `GET /wallets/{id}`). |
| `405` | Method not allowed on a known path. |
| `415` | Missing or wrong `Content-Type` header. |
| `503` | Database temporarily unreachable. |

Every error response is a JSON object:

```json
{
  "error": "no stock available in bank",
  "status": 400,
  "path": "/wallets/alice/stocks/AAPL",
  "requestId": "3f8a1c02",
  "timestamp": "2026-05-04T18:08:56.218Z"
}
```

Every response carries an `X-Request-ID` header (generated if not supplied by the caller) which ties the log line on the server to the error body returned to the client.

### Examples

```bash
# Seed the bank
curl -X POST localhost:8080/stocks \
  -H 'content-type: application/json' \
  -d '{"stocks":[{"name":"AAPL","quantity":100},{"name":"GOOG","quantity":50}]}'

# Buy a share — wallet "alice" is created automatically on first call
curl -X POST localhost:8080/wallets/alice/stocks/AAPL \
  -H 'content-type: application/json' \
  -d '{"type":"buy"}'

# Sell it back
curl -X POST localhost:8080/wallets/alice/stocks/AAPL \
  -H 'content-type: application/json' \
  -d '{"type":"sell"}'

# Inspect state
curl localhost:8080/wallets/alice
curl localhost:8080/wallets/alice/stocks/AAPL
curl localhost:8080/stocks
curl localhost:8080/log
```

## High availability and `/chaos`

`POST /chaos` is routed by HAProxy to one of the three Java replicas. That replica returns `200`, then a background thread calls `Runtime.getRuntime().halt(0)` after 150 ms (enough for the response to flush). HAProxy detects the dead backend within one health-check interval (≤ 1 s) and stops routing to it; in-flight idempotent requests are retried on a healthy peer (`option redispatch`, `retry-on all-retryable-errors`). Docker Compose restarts the killed container with `restart: unless-stopped`, so capacity is restored within seconds.

To observe it live:

```bash
# Terminal 1 — watch availability
while true; do curl -s -o /dev/null -w "%{http_code}\n" localhost:8080/stocks; sleep 0.3; done

# Terminal 2 — fire chaos
curl -X POST localhost:8080/chaos
```

You should see at most 1–2 non-200 responses, then a steady stream of 200s — without restarting the stack.

The same resilience applies to the Go audit replicas:

```bash
docker kill stockmarketsimulation-audit-go-1-1
curl localhost:8080/log    # 200, served by audit-go-2
```

## Tests

The project has three levels of testing: Java unit tests, Go vet, and a TypeScript black-box E2E suite. All three run automatically in CI on every push to `main`.

### Java unit tests (JUnit 5 + Testcontainers)

Tests run against a real Postgres instance spun up by Testcontainers — no mocks, no in-memory fakes.

```bash
cd services/stock-java
./gradlew test
```

| Test | What it covers |
| ---- | -------------- |
| `buy_createsWalletAndMovesStock` | Happy path — bank decremented, wallet incremented, wallet auto-created. |
| `buy_returns404_whenStockNotInBank` | Stock unknown to the bank → `ApiException(404)`. |
| `buy_returns400_whenBankHasZero` | Stock exists but quantity is 0 → `ApiException(400)`. |
| `sell_movesStockBackToBank` | Happy path — wallet decremented, bank incremented. |
| `sell_returns400_whenWalletHasNone` | No stock in wallet → `ApiException(400)`. |
| `sell_returns404_whenStockNotInBank` | Stock unknown to bank on sell → `ApiException(404)`. |
| `operate_appendsAuditLogOnlyForSuccessfulOperations` | Failed ops are not logged; successful ops appear in order. |
| `setBank_replacesEntireState` | Second `POST /stocks` replaces the first completely. |
| `setBank_returns400_forNegativeQuantity` | Negative quantity rejected at service level. |
| `concurrentBuys_neverOversell` | 100 virtual threads race to buy 50 units. Asserts exactly 50 × 200 and 50 × 400, bank ends at 0 — proves the row-lock strategy under contention. |

### Go vet

```bash
cd services/audit-go
go vet ./...
```

Static analysis of the Go audit service — catches misused `fmt` verbs, unreachable code, and similar issues.

### TypeScript E2E suite (Jest + axios)

Requires the stack to be running (`./run.sh 8080`). Node 20+ must be installed, or run via Docker:

```bash
# with local Node
cd tests && npm install && API_BASE=http://localhost:8080 npm test

# without local Node
docker run --rm --network host -v $(pwd)/tests:/tests -w /tests node:20-alpine \
  sh -c "npm install && API_BASE=http://localhost:8080 npm test"
```

Three suites run sequentially (`--runInBand`):

| Suite | What it proves |
| ----- | -------------- |
| `contract.test.ts` | Every endpoint, every documented status code (200/400/404/405), correct response shapes. |
| `concurrency.test.ts` | Fires 200 parallel buy requests against 100 units of stock across 5 wallets and 3 Java replicas. Asserts exactly 100 × 200, 100 × 400, and `bank + Σ wallets == 100`. End-to-end proof that the row-lock strategy is correct across the network. |
| `chaos.test.ts` | Calls `/chaos` three times with 2.5 s gaps, then verifies reads and writes still succeed on the surviving replicas. |

### CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull request to `main`:

1. **build-java** — `./gradlew build` (compiles + unit tests), then Docker image build.
2. **build-go** — `go build ./...` + `go vet ./...`, then Docker image build.
3. **build-frontend** — `npm run lint` (ESLint) + `npm run build`, then Docker image build.
4. **e2e** — starts the full stack with `docker compose up`, waits for readiness, runs the TypeScript E2E suite, dumps logs on failure.

## Design notes

### Concurrency model

Every buy/sell executes as a single Postgres transaction at `READ COMMITTED` isolation:

1. `SELECT quantity FROM bank_stocks WHERE name = ? FOR UPDATE` — locks the bank row for this stock. Returns 404 if the stock doesn't exist.
2. `INSERT INTO wallets … ON CONFLICT DO NOTHING` — auto-creates the wallet.
3. **Buy:** `UPDATE bank_stocks SET quantity = quantity - 1 WHERE name = ? AND quantity > 0`. Zero rows updated → 400. Then `wallet_stocks` `+1` via upsert.  
   **Sell:** symmetric — decrement `wallet_stocks`, increment `bank_stocks`.
4. `INSERT INTO audit_log …`
5. Commit.

The row lock in step 1 serialises concurrent writes per stock across all three Java replicas. The conditional `WHERE quantity > 0` in step 3 makes the inventory check and decrement atomic — no separate read, no race window.

### Java 21 virtual threads

`spring.threads.virtual.enabled: true` (Spring Boot 3.2+) makes Tomcat assign a virtual thread to each HTTP request instead of borrowing from a fixed platform thread pool. A virtual thread costs ~1 KB of stack (vs ~512 KB for a platform thread) and parks — rather than blocks — when waiting for JDBC, so a pool of 25 DB connections can serve thousands of concurrent requests without queuing at the thread level. Transaction timeouts (10 s for writes, 5 s for reads) ensure a stuck DB lock releases under sustained load instead of hanging forever.

### Why HAProxy instead of a custom Go gateway

A custom gateway on the exposed port would itself be a single point of failure. HAProxy is a single config file, battle-tested, and lets Go focus on something more meaningful — the audit log service — rather than being a thin proxy.

### Why Postgres for shared state

Three Java replicas serve writes simultaneously so state must live in one place they all see. Postgres row locking gives exactly the primitive needed: atomic check-and-decrement per stock. No oversell is possible regardless of replica count.

### Error handling

All exceptions surface as structured JSON with `error`, `status`, `path`, `requestId`, and `timestamp`. The `GlobalExceptionHandler` covers domain errors (404/400 from business rules), infrastructure errors (`DataAccessException` → 503), and Spring MVC exceptions (405, 415, 404 for unknown paths). A servlet filter assigns a correlation ID to every request and logs `METHOD path → status (ms) reqId=…` for every non-health call on both the Java and Go services.

## Repository layout

```
.
├── docker-compose.yml
├── run.sh / run.ps1                one-command start, takes PORT as argument
├── infra/
│   ├── postgres/init.sql           schema, auto-applied on first DB start
│   └── haproxy/haproxy.cfg        path-based routing, health checks, ${PORT} substitution
├── services/
│   ├── stock-java/                 Spring Boot 3 · Java 21 · Gradle Kotlin DSL
│   ├── audit-go/                   chi · pgx · single-binary Go service
│   └── frontend/                   React 18 · TypeScript · Vite · served via Nginx
└── tests/                          Jest · axios · contract + concurrency + chaos suites
```
