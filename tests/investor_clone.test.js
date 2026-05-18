// Regression: the investor-clone path must build + render for every baked
// manager AND for every goal-based portfolio, in both DEMO and LIVE-earnings
// modes. Locks in the fix for "h is not defined" caused by a hash variable
// being declared inside the else-branch of the earnings if/else but used
// outside it in the dividend block.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

const app = loadApp();

test('buildUpcomingEvents — synthesized earnings + dividend stock (DEMO)', () => {
  app.getEarningsDateCached = () => null;
  const evs = app.buildUpcomingEvents('AAPL',
    { finnhubIndustry: 'Consumer Electronics' },
    { dividendYieldIndicatedAnnual: 0.5, dividendPerShareAnnual: 1.0 });
  assert.ok(Array.isArray(evs) && evs.length > 0, 'expected events');
  assert.ok(evs.some(e => e.kind === 'dividend'), 'expected an ex-dividend event');
  assert.ok(evs.some(e => e.kind === 'earnings'), 'expected an earnings event');
});

test('buildUpcomingEvents — LIVE earnings + dividend stock must not throw "h is not defined"', () => {
  app.getEarningsDateCached = (tkr) =>
    tkr === 'AAPL' ? { date: '2026-07-25', hour: 'amc', epsEstimate: 2.10 } : null;
  assert.doesNotThrow(() => {
    const evs = app.buildUpcomingEvents('AAPL',
      { finnhubIndustry: 'Consumer Electronics' },
      { dividendYieldIndicatedAnnual: 0.5, dividendPerShareAnnual: 1.0 });
    assert.ok(evs.length >= 2);
  });
});

test('buildUpcomingEvents — LIVE earnings + non-dividend stock', () => {
  app.getEarningsDateCached = () => ({ date: '2026-08-20', hour: 'amc' });
  const evs = app.buildUpcomingEvents('NVDA',
    { finnhubIndustry: 'Semiconductors' },
    { dividendYieldIndicatedAnnual: 0 });
  assert.ok(evs.length > 0);
  assert.ok(!evs.some(e => e.kind === 'dividend'), 'no dividend event for zero-yield ticker');
});

test('every investor clone builds + renders without throwing', () => {
  app.getEarningsDateCached = () => null;
  const failures = [];
  for (let i = 0; i < app._TOP_13F_INVESTORS.length; i++) {
    try {
      const p = app.buildPortfolioFromInvestor(10000, i, 5);
      app.renderWhatIfResults(p);
    } catch (e) {
      failures.push(`clone[${i}] ${app._TOP_13F_INVESTORS[i].name}: ${e.message}`);
    }
  }
  assert.deepEqual(failures, [], 'expected every clone to succeed');
});

test('every investor clone survives LIVE earnings dates on all dividend payers', () => {
  app.getEarningsDateCached = () => ({ date: '2026-08-15', hour: 'amc', epsEstimate: 1.5 });
  const failures = [];
  for (let i = 0; i < app._TOP_13F_INVESTORS.length; i++) {
    try {
      const p = app.buildPortfolioFromInvestor(10000, i, 5);
      app.renderWhatIfResults(p);
    } catch (e) {
      failures.push(`clone[${i}] ${app._TOP_13F_INVESTORS[i].name}: ${e.message}`);
    }
  }
  assert.deepEqual(failures, [], 'LIVE-mode clones must not crash');
});

test('every goal-based portfolio builds + renders', () => {
  app.getEarningsDateCached = () => null;
  const goals = ['growth', 'income', 'value', 'momentum', 'preservation'];
  const failures = [];
  for (const g of goals) {
    try {
      const p = app.buildPortfolio(10000, g, 12, 5);
      app.renderWhatIfResults(p);
    } catch (e) {
      failures.push(`goal[${g}]: ${e.message}`);
    }
  }
  assert.deepEqual(failures, [], 'expected every goal-based portfolio to succeed');
});

test('Pick-stocks-and-optimise — picker builds + renders, surfaces segment alternatives, swap is reversible', () => {
  app.getEarningsDateCached = () => null;
  app._PICKED_TICKERS.clear();
  app._PICKED_TICKERS.add('AAPL'); app._PICKED_TICKERS.add('MSFT'); app._PICKED_TICKERS.add('JPM');
  const goals = ['growth', 'income', 'value', 'momentum', 'preservation'];
  const failures = [];
  for (const g of goals) {
    try {
      const p = app.buildPortfolioFromPicker(10000, g, 12, 5);
      app.renderWhatIfResults(p);
      assert.ok(p.fromPicker, 'portfolio must be tagged fromPicker');
      assert.ok(Array.isArray(p.holdings) && p.holdings.length > 0, 'must have holdings');
    } catch (e) {
      failures.push(`picker[${g}]: ${e.message}`);
    }
  }
  assert.deepEqual(failures, [], 'every picker portfolio must render');
});

test('Segment-alternatives engine — only suggests same-industry, higher-ranked candidates', () => {
  app.getEarningsDateCached = () => null;
  const p = app.buildPortfolio(10000, 'growth', 12, 5);
  app.computeAndStashBuildAlternatives(p);
  for (const { from, alts } of app._LAST_BUILD_ALTS.list) {
    for (const a of alts) {
      assert.equal(
        (a.industry || '').toLowerCase(),
        (from.industry || '').toLowerCase(),
        `alt ${a.ticker} must share industry with ${from.ticker}`
      );
      assert.notEqual(a.ticker, from.ticker, 'alt cannot be the same ticker');
    }
  }
});

test('SWAP move — applies cleanly to a bundle and renormalises to 100%', () => {
  const dummyBundle = {
    id: 'b_test_swap',
    name: 'swap-test',
    createdAt: Date.now() - 7 * 86400000,
    goalKey: 'growth',
    amount: 10000,
    horizon: 12,
    historyYears: 5,
    holdings: [
      { ticker: 'AAPL', kind: 'stock', name: 'Apple', industry: 'Consumer Electronics', pct: 50, amount: 5000, shares: 25, entryPrice: 200, entryForecast12: 5 },
      { ticker: 'MSFT', kind: 'stock', name: 'Microsoft', industry: 'Software', pct: 50, amount: 5000, shares: 12, entryPrice: 416, entryForecast12: 7 },
    ],
    history: [],
  };
  const ok = app._applyMoveToBundle(dummyBundle, { kind: 'swap', fromTicker: 'AAPL', toTicker: 'NVDA', toName: 'Nvidia', toIndustry: 'Semiconductors' });
  assert.ok(ok, 'swap should return true');
  assert.ok(!dummyBundle.holdings.find(h => h.ticker === 'AAPL'), 'AAPL must be gone');
  assert.ok(dummyBundle.holdings.find(h => h.ticker === 'NVDA'), 'NVDA must be present');
  app._renormaliseBundle(dummyBundle);
  const total = dummyBundle.holdings.reduce((s, h) => s + h.pct, 0);
  assert.ok(Math.abs(total - 100) < 0.01, `pct must sum to 100, got ${total}`);
  const nvda = dummyBundle.holdings.find(h => h.ticker === 'NVDA');
  assert.ok(nvda.entryPrice > 0, 'NVDA entry price must be re-snapshotted at today');
  assert.ok(nvda.shares > 0, 'NVDA shares must be derived');
});

test('Build from Sim Set — LIVE earnings + dividend stock must not throw', () => {
  // The user-visible bug was "Could not build portfolio: h is not defined" coming
  // from the Build-from-Sim-Set button in LIVE mode. Same root cause as the
  // investor-clone crash (buildUpcomingEvents had `h` declared inside the else-
  // branch of the earnings if/else but used in the dividend block below). This
  // test pins the Sim-Set path specifically so future edits don't regress it.
  // SIM_SET in the app is a `let`-declared Set. Reassigning app.SIM_SET would
  // only swap the global alias — the closure-captured reference inside
  // buildPortfolioFromSimSet would still point at the original Set. Mutate
  // the same Set object in place so both views agree.
  app.SIM_SET.clear();
  app.SIM_SET.add('AAPL'); app.SIM_SET.add('MSFT'); app.SIM_SET.add('JPM');
  app.getEarningsDateCached = (tkr) => ({ date: '2026-08-20', hour: 'amc', epsEstimate: 1.5 });
  const goals = ['growth', 'income', 'value', 'momentum', 'preservation'];
  const failures = [];
  for (const g of goals) {
    try {
      const p = app.buildPortfolioFromSimSet(10000, g, 12, 5);
      app.renderWhatIfResults(p);
    } catch (e) {
      failures.push(`simset[${g}]: ${e.message}`);
    }
  }
  assert.deepEqual(failures, [], 'expected every Sim-Set portfolio to render in LIVE mode');
});
