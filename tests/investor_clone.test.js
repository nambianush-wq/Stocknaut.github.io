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
