// Multi-scenario smoke for the fetchBars source-priority chain.
//
// Doctrine: 2026-05-18 RCA on ACN "Synthetic data — live fetch failed"
// banner. The chain must walk: Yahoo → Twelve Data → Finnhub → hybrid →
// fallback. The user's deployed env had Yahoo CORS-blocking, Finnhub
// /candle paywalled, and Finnhub /quote returning null — so we landed in
// 'fallback' even though Twelve Data was already reachable (same key fed
// the cross-check chip successfully).
//
// Five scenarios per anush-rca Phase 4.5 doctrine:
//   1. Verbatim regression: Yahoo throws, TD works, expect source='twelvedata'
//   2. Inverse: Yahoo works, expect source='yahoo' (TD never called)
//   3. Sibling shape: all bar sources throw, quote works, expect 'hybrid'
//   4. Edge case: all sources throw, quote returns null, expect 'fallback'
//   5. Cross-scope: Yahoo throws, TD throws, Finnhub paid works, expect 'live'

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

// Helper — stub global.fetch with a per-test response chain so we can drive
// each fall-through path deterministically.
function stubFetchSequence(app, handlers) {
  const calls = [];
  const matchers = handlers.map(h => ({ ...h, hits: 0 }));
  app.fetch = async (url, opts) => {
    calls.push(String(url));
    for (const m of matchers) {
      if (m.match(url)) {
        m.hits++;
        return m.respond(url, opts);
      }
    }
    throw new Error(`unstubbed fetch: ${url}`);
  };
  return { calls, matchers };
}

// Build a Twelve Data /time_series success response.
function tdSuccessResponse(ticker) {
  const values = [];
  // 260 weeks of fake-but-plausible bars, descending order (newest first)
  for (let i = 0; i < 260; i++) {
    const wkAgo = i;
    const close = 170 + Math.sin(wkAgo / 8) * 15;
    const open  = close * 0.99;
    const high  = close * 1.01;
    const low   = close * 0.98;
    const vol   = 1_000_000;
    const date = new Date(Date.now() - wkAgo * 7 * 86400000);
    values.push({
      datetime: date.toISOString().slice(0, 10),
      open: open.toFixed(2),
      high: high.toFixed(2),
      low:  low.toFixed(2),
      close: close.toFixed(2),
      volume: String(vol),
    });
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ meta: { symbol: ticker, interval: '1week' }, values, status: 'ok' }),
  };
}

// Yahoo success response — generates 260 weekly bars in the chart format.
function yahooSuccessResponse(ticker) {
  const ts = [];
  const close = [], open = [], high = [], low = [], volume = [];
  for (let i = 259; i >= 0; i--) {
    const wkAgo = i;
    const c = 180 + Math.cos(wkAgo / 6) * 12;
    ts.push(Math.floor((Date.now() - wkAgo * 7 * 86400000) / 1000));
    close.push(c);
    open.push(c * 0.99);
    high.push(c * 1.01);
    low.push(c * 0.98);
    volume.push(1_000_000);
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({
      chart: {
        result: [{
          meta: { symbol: ticker, regularMarketPrice: close[close.length - 1] },
          timestamp: ts,
          indicators: { quote: [{ open, high, low, close, volume }] },
        }],
      },
    }),
  };
}

// Finnhub /quote success response — used for hybrid path tests.
function finnhubQuoteSuccess(price) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ c: price, d: 1.50, dp: 0.85, h: price * 1.02, l: price * 0.98, pc: price * 0.99, o: price * 1.00 }),
  };
}

function finnhubCandleFail() {
  return { ok: false, status: 403, json: async () => ({}) };
}

function yahooFail() {
  return { ok: false, status: 401, json: async () => ({}) };
}

function tdFail() {
  return { ok: false, status: 429, json: async () => ({ status: 'error', message: 'rate limit' }) };
}

// === Scenario 1: VERBATIM REGRESSION ===
// Yahoo throws → TD works → expect source='twelvedata'. This is the exact
// failure mode the user reported on 2026-05-18 with ACN.
test('Scenario 1 (verbatim): Yahoo throws, TD succeeds → source=twelvedata', async () => {
  const app = loadApp();
  // API_KEY + TD_API_KEY are baked into the inline script (operator-baked
   // defaults). isLive() reads the internal let-binding which is truthy.
const { calls } = stubFetchSequence(app, [
    { match: u => u.includes('query1.finance.yahoo.com'), respond: () => yahooFail() },
    { match: u => u.includes('api.twelvedata.com/time_series'), respond: () => tdSuccessResponse('ACN') },
  ]);
  const r = await app.fetchBars('ACN');
  assert.equal(r.source, 'twelvedata', `expected source='twelvedata', got '${r.source}' (${calls.length} fetches)`);
  assert.ok(Array.isArray(r.bars) && r.bars.length > 100, `expected >100 bars, got ${r.bars && r.bars.length}`);
});

// === Scenario 2: INVERSE ===
// Yahoo works → TD must NOT be called (would waste quota) → source='yahoo'.
test('Scenario 2 (inverse): Yahoo succeeds → source=yahoo, TD never called', async () => {
  const app = loadApp();
  // API_KEY + TD_API_KEY are baked into the inline script (operator-baked
   // defaults). isLive() reads the internal let-binding which is truthy.
const { calls, matchers } = stubFetchSequence(app, [
    { match: u => u.includes('query1.finance.yahoo.com'), respond: () => yahooSuccessResponse('AAPL') },
    { match: u => u.includes('api.twelvedata.com/time_series'), respond: () => tdSuccessResponse('AAPL') },
  ]);
  const r = await app.fetchBars('AAPL');
  assert.equal(r.source, 'yahoo', `expected source='yahoo', got '${r.source}'`);
  const tdMatcher = matchers.find(m => m.match('https://api.twelvedata.com/time_series?symbol=X'));
  assert.equal(tdMatcher.hits, 0, `expected TD never called when Yahoo succeeds, got ${tdMatcher.hits} hits`);
});

// === Scenario 3: SIBLING SHAPE ===
// All bar sources throw, /quote works → expect 'hybrid' (existing behaviour, must still work after the TD insertion).
test('Scenario 3 (sibling): Yahoo/TD/candle all throw, /quote works → source=hybrid', async () => {
  const app = loadApp();
  // API_KEY + TD_API_KEY are baked into the inline script (operator-baked
   // defaults). isLive() reads the internal let-binding which is truthy.
stubFetchSequence(app, [
    { match: u => u.includes('query1.finance.yahoo.com'), respond: () => yahooFail() },
    { match: u => u.includes('api.twelvedata.com/time_series'), respond: () => tdFail() },
    { match: u => u.includes('finnhub.io/api/v1/stock/candle'), respond: () => finnhubCandleFail() },
    { match: u => u.includes('finnhub.io/api/v1/quote'), respond: () => finnhubQuoteSuccess(175.47) },
  ]);
  const r = await app.fetchBars('ACN');
  assert.equal(r.source, 'hybrid', `expected source='hybrid', got '${r.source}'`);
  // Last bar must be re-priced to the live quote price (the hybrid contract)
  const lastClose = r.bars[r.bars.length - 1].close;
  assert.ok(Math.abs(lastClose - 175.47) < 0.01, `expected last bar close ~175.47, got ${lastClose}`);
});

// === Scenario 4: EDGE CASE ===
// All sources throw, /quote returns null too → expect 'fallback'.
test('Scenario 4 (edge): everything fails → source=fallback', async () => {
  const app = loadApp();
  // API_KEY + TD_API_KEY are baked into the inline script (operator-baked
   // defaults). isLive() reads the internal let-binding which is truthy.
stubFetchSequence(app, [
    { match: u => u.includes('query1.finance.yahoo.com'), respond: () => yahooFail() },
    { match: u => u.includes('api.twelvedata.com/time_series'), respond: () => tdFail() },
    { match: u => u.includes('finnhub.io/api/v1/stock/candle'), respond: () => finnhubCandleFail() },
    { match: u => u.includes('finnhub.io/api/v1/quote'), respond: () => ({ ok: false, status: 429, json: async () => ({}) }) },
  ]);
  const r = await app.fetchBars('ACN');
  assert.equal(r.source, 'fallback', `expected source='fallback', got '${r.source}'`);
});

// === Scenario 5: CROSS-SCOPE ===
// Yahoo + TD throw, Finnhub /candle (paid tier) succeeds → expect 'live'.
// Pins that the Finnhub-paid-tier path still works as 3rd option in chain.
test('Scenario 5 (cross-scope): Yahoo + TD throw, Finnhub /candle works → source=live', async () => {
  const app = loadApp();
  app.API_KEY = 'test-fh-paid-key';
  app.TD_API_KEY = 'test-td-key';
  // Mock Finnhub /candle success — same shape as fetchFinnhubWeekly expects.
  const fhCandle = {
    ok: true,
    status: 200,
    json: async () => {
      const ts = [];
      const o = [], h = [], l = [], c = [], v = [];
      for (let i = 259; i >= 0; i--) {
        const cl = 150 + Math.sin(i / 4) * 10;
        ts.push(Math.floor((Date.now() - i * 7 * 86400000) / 1000));
        o.push(cl * 0.99); h.push(cl * 1.01); l.push(cl * 0.98); c.push(cl); v.push(1_000_000);
      }
      return { s: 'ok', t: ts, o, h, l, c, v };
    },
  };
  stubFetchSequence(app, [
    { match: u => u.includes('query1.finance.yahoo.com'), respond: () => yahooFail() },
    { match: u => u.includes('api.twelvedata.com/time_series'), respond: () => tdFail() },
    { match: u => u.includes('finnhub.io/api/v1/stock/candle'), respond: () => fhCandle },
  ]);
  const r = await app.fetchBars('SPY');
  assert.equal(r.source, 'live', `expected source='live', got '${r.source}'`);
  assert.ok(Array.isArray(r.bars) && r.bars.length > 100, `expected >100 bars`);
});
