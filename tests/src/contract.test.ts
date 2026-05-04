import { api, resetBank, waitReady } from './client';

beforeAll(async () => {
  await waitReady();
});

beforeEach(async () => {
  await resetBank();
});

describe('GET /stocks', () => {
  test('returns empty list when bank is empty', async () => {
    const r = await api.get('/stocks');
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ stocks: [] });
  });
});

describe('POST /stocks', () => {
  test('replaces bank state and returns 200', async () => {
    const r = await api.post('/stocks', {
      stocks: [
        { name: 'AAPL', quantity: 100 },
        { name: 'GOOG', quantity: 50 },
      ],
    });
    expect(r.status).toBe(200);

    const r2 = await api.get('/stocks');
    expect(r2.status).toBe(200);
    const byName = Object.fromEntries(r2.data.stocks.map((s: any) => [s.name, s.quantity]));
    expect(byName).toEqual({ AAPL: 100, GOOG: 50 });
  });
});

describe('POST /wallets/{id}/stocks/{name} buy', () => {
  test('buy creates wallet, decrements bank, increments wallet', async () => {
    await api.post('/stocks', { stocks: [{ name: 'AAPL', quantity: 10 }] });

    const r = await api.post('/wallets/buy-w1/stocks/AAPL', { type: 'buy' });
    expect(r.status).toBe(200);

    const wallet = await api.get('/wallets/buy-w1');
    expect(wallet.status).toBe(200);
    expect(wallet.data.id).toBe('buy-w1');
    expect(wallet.data.stocks).toEqual([{ name: 'AAPL', quantity: 1 }]);

    const bank = await api.get('/stocks');
    expect(bank.data.stocks).toEqual([{ name: 'AAPL', quantity: 9 }]);
  });

  test('buy returns 404 when stock does not exist', async () => {
    const r = await api.post('/wallets/buy-404/stocks/UNKNOWN', { type: 'buy' });
    expect(r.status).toBe(404);
  });

  test('buy returns 400 when bank has 0 of the stock', async () => {
    await api.post('/stocks', { stocks: [{ name: 'EMPTY', quantity: 0 }] });
    const r = await api.post('/wallets/buy-empty/stocks/EMPTY', { type: 'buy' });
    expect(r.status).toBe(400);
  });
});

describe('POST /wallets/{id}/stocks/{name} sell', () => {
  test('sell returns 400 when wallet has none of the stock', async () => {
    await api.post('/stocks', { stocks: [{ name: 'AAPL', quantity: 10 }] });
    const r = await api.post('/wallets/sell-empty/stocks/AAPL', { type: 'sell' });
    expect(r.status).toBe(400);
  });

  test('sell returns 404 when stock does not exist', async () => {
    const r = await api.post('/wallets/sell-404/stocks/NOPE', { type: 'sell' });
    expect(r.status).toBe(404);
  });

  test('sell returns the stock to the bank', async () => {
    await api.post('/stocks', { stocks: [{ name: 'AAPL', quantity: 10 }] });
    expect((await api.post('/wallets/sell-w1/stocks/AAPL', { type: 'buy' })).status).toBe(200);
    expect((await api.post('/wallets/sell-w1/stocks/AAPL', { type: 'sell' })).status).toBe(200);

    const wallet = await api.get('/wallets/sell-w1');
    const aapl = wallet.data.stocks.find((s: any) => s.name === 'AAPL');
    expect(aapl?.quantity ?? 0).toBe(0);

    const bank = await api.get('/stocks');
    expect(bank.data.stocks.find((s: any) => s.name === 'AAPL').quantity).toBe(10);
  });
});

describe('GET /wallets/{id}/stocks/{name}', () => {
  test('returns the wallet stock quantity as a single number', async () => {
    await api.post('/stocks', { stocks: [{ name: 'AAPL', quantity: 5 }] });
    await api.post('/wallets/qty-w1/stocks/AAPL', { type: 'buy' });
    await api.post('/wallets/qty-w1/stocks/AAPL', { type: 'buy' });

    const r = await api.get('/wallets/qty-w1/stocks/AAPL');
    expect(r.status).toBe(200);
    expect(r.data).toBe(2);
  });
});

describe('GET /log', () => {
  test('returns only successful operations in order of occurrence', async () => {
    await api.post('/stocks', { stocks: [{ name: 'A', quantity: 5 }] });

    expect((await api.post('/wallets/log-w/stocks/A', { type: 'buy' })).status).toBe(200);
    expect((await api.post('/wallets/log-w/stocks/UNKNOWN', { type: 'buy' })).status).toBe(404);
    expect((await api.post('/wallets/log-w/stocks/A', { type: 'sell' })).status).toBe(200);

    const r = await api.get('/log');
    expect(r.status).toBe(200);
    const ours = r.data.log.filter((e: any) => e.wallet_id === 'log-w');
    expect(ours).toEqual([
      { type: 'buy',  wallet_id: 'log-w', stock_name: 'A' },
      { type: 'sell', wallet_id: 'log-w', stock_name: 'A' },
    ]);
  });
});
