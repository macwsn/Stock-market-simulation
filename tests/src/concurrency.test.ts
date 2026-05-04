import { api, resetBank, waitReady } from './client';

beforeAll(async () => {
  await waitReady();
});

beforeEach(async () => {
  await resetBank();
});

describe('Concurrency', () => {
  test('concurrent buys conserve total stock count', async () => {
    const TOTAL = 100;
    await api.post('/stocks', { stocks: [{ name: 'CONC', quantity: TOTAL }] });

    const wallets = ['c-w1', 'c-w2', 'c-w3', 'c-w4', 'c-w5'];
    const attempts = TOTAL * 2; // intentionally over-subscribe
    const promises = Array.from({ length: attempts }, (_, i) =>
      api.post(`/wallets/${wallets[i % wallets.length]}/stocks/CONC`, { type: 'buy' })
    );

    const results = await Promise.all(promises);
    const ok    = results.filter((r) => r.status === 200).length;
    const bad   = results.filter((r) => r.status === 400).length;
    const other = results.filter((r) => r.status !== 200 && r.status !== 400);
    expect(other).toEqual([]);
    expect(ok).toBe(TOTAL);
    expect(bad).toBe(attempts - TOTAL);

    const bank = await api.get('/stocks');
    const bankQty = bank.data.stocks.find((s: any) => s.name === 'CONC').quantity;
    expect(bankQty).toBe(0);

    let walletTotal = 0;
    for (const w of wallets) {
      const wallet = await api.get(`/wallets/${w}`);
      const entry  = wallet.data.stocks.find((s: any) => s.name === 'CONC');
      walletTotal += entry?.quantity ?? 0;
    }
    expect(walletTotal).toBe(TOTAL);
    expect(bankQty + walletTotal).toBe(TOTAL);
  }, 60_000);
});
