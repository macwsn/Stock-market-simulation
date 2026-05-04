import { useCallback, useEffect, useRef, useState } from 'react';

/* ---------- types ---------- */
interface StockEntry  { name: string; quantity: number; }
interface LogEntry    { type: 'buy' | 'sell'; wallet_id: string; stock_name: string; }
interface SeedRow     { name: string; quantity: string; }

/* ---------- tiny api ---------- */
async function apiFetch(path: string, opts?: RequestInit) {
  const r = await fetch(path, opts);
  return r;
}

/* ---------- toast ---------- */
function Toast({ msg, ok }: { msg: string; ok: boolean }) {
  return <span className={`toast ${ok ? 'ok' : 'err'}`}>{msg}</span>;
}

/* ---------- bank panel ---------- */
function BankPanel() {
  const [stocks, setStocks]     = useState<StockEntry[]>([]);
  const [seedRows, setSeedRows] = useState<SeedRow[]>([{ name: '', quantity: '' }]);
  const [toast, setToast]       = useState<{ msg: string; ok: boolean } | null>(null);

  const refresh = useCallback(async () => {
    const r = await apiFetch('/stocks');
    if (r.ok) setStocks((await r.json()).stocks);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  function addSeedRow() { setSeedRows(prev => [...prev, { name: '', quantity: '' }]); }
  function removeSeedRow(i: number) { setSeedRows(prev => prev.filter((_, j) => j !== i)); }
  function updateSeedRow(i: number, field: keyof SeedRow, val: string) {
    setSeedRows(prev => prev.map((r, j) => j === i ? { ...r, [field]: val } : r));
  }

  async function setBank() {
    const payload = seedRows
      .filter(r => r.name.trim())
      .map(r => ({ name: r.name.trim(), quantity: Math.max(0, parseInt(r.quantity) || 0) }));
    const res = await apiFetch('/stocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stocks: payload }),
    });
    setToast({ msg: res.ok ? 'Bank updated' : `Error ${res.status}`, ok: res.ok });
    if (res.ok) { refresh(); setSeedRows([{ name: '', quantity: '' }]); }
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2>Bank</h2>
        <button onClick={refresh}>↻ Refresh</button>
      </div>

      {stocks.length === 0
        ? <p className="empty">No stocks in bank</p>
        : <table>
            <thead><tr><th>Stock</th><th>Quantity</th></tr></thead>
            <tbody>
              {stocks.map(s => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td><span className="quantity">{s.quantity}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
      }

      <h2 style={{ marginTop: '.5rem' }}>Set bank state</h2>
      {seedRows.map((row, i) => (
        <div key={i} className="seed-entry">
          <input
            type="text" placeholder="Stock name"
            value={row.name}
            onChange={e => updateSeedRow(i, 'name', e.target.value)}
          />
          <input
            type="number" placeholder="Qty" min={0}
            value={row.quantity}
            onChange={e => updateSeedRow(i, 'quantity', e.target.value)}
            style={{ width: 90, flex: 'none' }}
          />
          <button className="remove" onClick={() => removeSeedRow(i)}>✕</button>
        </div>
      ))}
      <div className="row">
        <button onClick={addSeedRow}>+ Add row</button>
        <button className="primary" onClick={setBank}>Set bank</button>
        {toast && <Toast {...toast} />}
      </div>
    </div>
  );
}

/* ---------- trade panel ---------- */
function TradePanel({ onDone }: { onDone: () => void }) {
  const [walletId,  setWalletId]  = useState('');
  const [stockName, setStockName] = useState('');
  const [type,      setType]      = useState<'buy' | 'sell'>('buy');
  const [toast, setToast]         = useState<{ msg: string; ok: boolean } | null>(null);

  async function execute() {
    if (!walletId.trim() || !stockName.trim()) return;
    const res = await apiFetch(`/wallets/${encodeURIComponent(walletId.trim())}/stocks/${encodeURIComponent(stockName.trim())}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
    });
    const msg =
      res.status === 200 ? `${type.toUpperCase()} successful` :
      res.status === 404 ? 'Stock not found (404)' :
      res.status === 400 ? (type === 'buy' ? 'Bank has 0 of this stock (400)' : 'Wallet has 0 of this stock (400)') :
      `Error ${res.status}`;
    setToast({ msg, ok: res.ok });
    if (res.ok) onDone();
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div className="card">
      <h2>Trade</h2>
      <div>
        <label>Wallet ID</label>
        <input type="text" placeholder="e.g. alice" value={walletId} onChange={e => setWalletId(e.target.value)} />
      </div>
      <div>
        <label>Stock name</label>
        <input type="text" placeholder="e.g. AAPL" value={stockName} onChange={e => setStockName(e.target.value)} />
      </div>
      <div>
        <label>Operation</label>
        <select value={type} onChange={e => setType(e.target.value as 'buy' | 'sell')}>
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
      </div>
      <div className="row">
        <button className={type === 'buy' ? 'success' : 'danger'} onClick={execute}>
          {type === 'buy' ? '↑ Buy' : '↓ Sell'}
        </button>
        {toast && <Toast {...toast} />}
      </div>
    </div>
  );
}

/* ---------- wallet panel ---------- */
function WalletPanel() {
  const [walletId, setWalletId] = useState('');
  const [stocks,   setStocks]   = useState<StockEntry[] | null>(null);
  const [toast,    setToast]    = useState<{ msg: string; ok: boolean } | null>(null);

  async function lookup() {
    if (!walletId.trim()) return;
    const res = await apiFetch(`/wallets/${encodeURIComponent(walletId.trim())}`);
    if (res.ok) {
      setStocks((await res.json()).stocks);
      setToast(null);
    } else {
      setStocks(null);
      setToast({ msg: res.status === 404 ? 'Wallet not found' : `Error ${res.status}`, ok: false });
      setTimeout(() => setToast(null), 3000);
    }
  }

  return (
    <div className="card">
      <h2>Wallet</h2>
      <div className="row">
        <div style={{ flex: 1 }}>
          <label>Wallet ID</label>
          <input
            type="text" placeholder="e.g. alice"
            value={walletId}
            onChange={e => setWalletId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && lookup()}
          />
        </div>
        <button className="primary" onClick={lookup}>Look up</button>
      </div>
      {toast && <Toast {...toast} />}
      {stocks !== null && (
        stocks.length === 0
          ? <p className="empty">Wallet is empty</p>
          : <table>
              <thead><tr><th>Stock</th><th>Quantity</th></tr></thead>
              <tbody>
                {stocks.map(s => (
                  <tr key={s.name}>
                    <td>{s.name}</td>
                    <td><span className="quantity">{s.quantity}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
      )}
    </div>
  );
}

/* ---------- log panel ---------- */
function LogPanel({ refresh }: { refresh: number }) {
  const [log, setLog] = useState<LogEntry[]>([]);

  useEffect(() => {
    apiFetch('/log').then(r => r.json()).then(d => setLog(d.log ?? []));
  }, [refresh]);

  return (
    <div className="card full">
      <h2>Audit log ({log.length} entries)</h2>
      {log.length === 0
        ? <p className="empty">No operations yet</p>
        : <div className="log-table">
            <table>
              <thead>
                <tr><th>#</th><th>Type</th><th>Wallet</th><th>Stock</th></tr>
              </thead>
              <tbody>
                {[...log].reverse().map((e, i) => (
                  <tr key={i}>
                    <td style={{ color: 'var(--muted)' }}>{log.length - i}</td>
                    <td><span className={`badge ${e.type}`}>{e.type}</span></td>
                    <td>{e.wallet_id}</td>
                    <td>{e.stock_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      }
    </div>
  );
}

/* ---------- chaos button ---------- */
function ChaosButton() {
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  async function chaos() {
    const res = await apiFetch('/chaos', { method: 'POST' }).catch(() => null);
    setToast({ msg: res?.ok ? 'Instance killed — HA rerouting…' : 'No response (instance already dead)', ok: true });
    setTimeout(() => setToast(null), 4000);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
      <button className="danger" onClick={chaos}>☠ Chaos</button>
      {toast && <Toast {...toast} />}
    </div>
  );
}

/* ---------- root ---------- */
export default function App() {
  const [logRefresh, setLogRefresh] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => setLogRefresh(n => n + 1), 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  function afterTrade() { setLogRefresh(n => n + 1); }

  return (
    <div className="app">
      <header>
        <div>
          <h1>Stock Market Simulation</h1>
        </div>
        <ChaosButton />
      </header>

      <div className="grid">
        <BankPanel />
        <TradePanel onDone={afterTrade} />
        <WalletPanel />
        <LogPanel refresh={logRefresh} />
      </div>
    </div>
  );
}
