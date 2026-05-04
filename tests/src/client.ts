import axios, { AxiosInstance } from 'axios';

export const BASE_URL = process.env.API_BASE ?? 'http://localhost:8080';

export const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  validateStatus: () => true,
  timeout: 10_000,
});

export async function waitReady(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const hz = await api.get('/healthz');
      const stk = await api.get('/stocks');
      const log = await api.get('/log');
      if (hz.status === 200 && stk.status === 200 && log.status === 200) return;
    } catch (e) {
      lastErr = e;
    }
    await sleep(1000);
  }
  throw new Error(`service not ready in time: ${lastErr}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function resetBank(): Promise<void> {
  const r = await api.post('/stocks', { stocks: [] });
  if (r.status !== 200) throw new Error(`reset failed: ${r.status}`);
}
