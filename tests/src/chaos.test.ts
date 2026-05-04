import { api, resetBank, sleep, waitReady } from './client';

beforeAll(async () => {
  await waitReady();
});

beforeEach(async () => {
  await resetBank();
});

describe('HA / chaos', () => {
  test('service stays available after /chaos kills a backend', async () => {
    await api.post('/stocks', { stocks: [{ name: 'HA', quantity: 50 }] });

    for (let i = 0; i < 3; i++) {
      await api.post('/chaos').catch(() => undefined);
      await sleep(2_500); // allow HAProxy to mark the dead backend down
    }

    // Service must still respond to a fresh request.
    const stocks = await api.get('/stocks');
    expect(stocks.status).toBe(200);

    // And accept new write operations.
    const buy = await api.post('/wallets/ha-w1/stocks/HA', { type: 'buy' });
    expect(buy.status).toBe(200);

    const wallet = await api.get('/wallets/ha-w1');
    expect(wallet.data.stocks.find((s: any) => s.name === 'HA').quantity).toBe(1);
  }, 90_000);
});
