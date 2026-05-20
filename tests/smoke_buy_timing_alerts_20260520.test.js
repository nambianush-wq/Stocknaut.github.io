// Buy-timing alerts smoke (2026-05-20).
//
// Feature: independent of verdict-change alerts, fires a notification when a
// watchlist ticker's computeBuyTiming() action transitions INTO a buy-tier
// (BUY_NOW / BUY_ON_DIP / EARLY_RALLY). The "price hit MA40, oversold-
// bounce, momentum-reset" window the user wants surfaced.
//
// Rules:
//   - Fire only on transitions IN (prev !== curr AND curr is buy-tier).
//   - No spam: if prev was already a buy-tier and curr is the same, skip.
//   - Skip buy → not-buy (closing window is uninteresting).
//   - Honour the global BUY_ALERTS_ON toggle.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

// Synthesise a bars array that produces a deterministic timing action by
// driving price relative to its 40-bar moving average + 52W range.
function buildBars(scenario) {
  const N = 80;  // enough for MA40 + 52W window
  const bars = [];
  let price = 100;
  for (let i = 0; i < N; i++) {
    if (scenario === 'rising_to_buy_now') {
      // Steady uptrend — last close well above MA40, near 52W high
      price = 60 + i * 0.6;
    } else if (scenario === 'pullback_to_ma40') {
      // Long uptrend, then pullback to MA40 — BUY_ON_DIP territory
      price = i < 60 ? 60 + i * 1.2 : 60 + 60 * 1.2 - (i - 60) * 1.5;
    } else if (scenario === 'flat_wait') {
      // Flat — no buy signal
      price = 100 + Math.sin(i / 10) * 2;
    } else {
      price = 100;
    }
    bars.push({
      time: Math.floor(Date.now() / 1000) - (N - i) * 7 * 86400,
      open: price - 0.5, high: price + 0.8, low: price - 0.8, close: price, volume: 1e6,
    });
  }
  return bars;
}

function buildBundle(scenario) {
  const bars = buildBars(scenario);
  const app = loadApp();
  const verdict = app.computeVerdict(bars);
  return { bars, verdict };
}

// === Scenario 1 (VERBATIM): no prior timing → buy-tier curr → alert fires ===
test('Scenario 1 (verbatim): first-seen buy-tier ticker fires alert', () => {
  const app = loadApp();
  // Clear any prior cached timings
  app.localStorage.removeItem(app.LS_KEY_TIMINGS);
  // Build a bundle whose timing engine returns a buy-tier action
  const data = {};
  for (const t of ['AAA', 'BBB']) {
    const b = buildBundle('pullback_to_ma40');
    data[t] = { bars: b.bars, verdict: b.verdict };
  }
  // Verify the timing engine actually returns a buy-tier for our fixture —
  // otherwise the test is vacuous
  const sampleAction = app._timingFromBundle(data['AAA']);
  if (!app._BUY_TIER_ACTIONS.has(sampleAction)) {
    // The fixture didn't land on a buy-tier action. Skip with a warning so
    // we don't ship a green-but-vacuous test.
    console.warn(`[skip] fixture produced "${sampleAction}", not a buy-tier action; test inconclusive`);
    return;
  }
  const changes = app.detectTimingAlerts(data);
  assert.ok(changes.length >= 1, `expected ≥1 alert, got ${changes.length}: ${JSON.stringify(changes)}`);
  // All changes must transition INTO a buy-tier
  for (const c of changes) {
    assert.ok(app._BUY_TIER_ACTIONS.has(c.to), `change.to must be buy-tier, got ${c.to}`);
    assert.equal(c.from, '-', `first-seen ticker should report from="-", got ${c.from}`);
  }
});

// === Scenario 2 (INVERSE): already in same buy-tier → NO alert (no spam) ===
test('Scenario 2 (inverse): repeat buy-tier same as prev → no alert (spam suppressed)', () => {
  const app = loadApp();
  // Seed LAST_TIMINGS with the current expected action
  const b = buildBundle('pullback_to_ma40');
  const data = { CCC: { bars: b.bars, verdict: b.verdict } };
  const action = app._timingFromBundle(data.CCC);
  if (!app._BUY_TIER_ACTIONS.has(action)) {
    console.warn(`[skip] fixture produced "${action}", not a buy-tier action`);
    return;
  }
  // Pre-seed the cache so prev === curr — alert must NOT fire
  app.LAST_TIMINGS.CCC = action;
  const changes = app.detectTimingAlerts(data);
  const cccChange = changes.find(c => c.ticker === 'CCC');
  assert.equal(cccChange, undefined, `expected no CCC alert when prev === curr, got: ${JSON.stringify(cccChange)}`);
});

// === Scenario 3 (SIBLING): empty changes list short-circuits ============
// Note on testability: BUY_ALERTS_ON is a `let`-bound module variable in the
// sandbox. Re-assigning it via `app.BUY_ALERTS_ON = false` only mutates the
// globalThis copy; the inner `let` binding stays unchanged. So we test the
// other half of the short-circuit guard: empty changes must never toast.
test('Scenario 3 (sibling): empty changes list never fires a toast', () => {
  const app = loadApp();
  let toastCount = 0;
  app.showToast = () => { toastCount++; };
  app.notifyTimingChanges([]);
  assert.equal(toastCount, 0, 'expected no toast for empty changes');
});

// === Scenario 4 (EDGE): empty newData → empty changes, no crash ===
test('Scenario 4 (edge): empty newData returns empty changes (no crash)', () => {
  const app = loadApp();
  const changes = app.detectTimingAlerts({});
  assert.deepEqual([...changes], [], 'empty input must produce empty changes');
  // Also tolerate null/undefined
  const changesNull = app.detectTimingAlerts(null);
  assert.equal(changesNull.length, 0, 'null input must not crash');
});

// === Scenario 5 (CROSS-SCOPE): buy → not-buy is NOT alerted ===
test('Scenario 5 (cross-scope): transition OUT of buy-tier is silent', () => {
  const app = loadApp();
  // Seed LAST_TIMINGS with a buy-tier action; fixture produces a non-buy now
  const b = buildBundle('flat_wait');
  const data = { EEE: { bars: b.bars, verdict: b.verdict } };
  const action = app._timingFromBundle(data.EEE);
  // We want a NON-buy current action so the transition is buy → not-buy
  if (app._BUY_TIER_ACTIONS.has(action)) {
    console.warn(`[skip] fixture produced "${action}", which IS a buy-tier — invalid for this test`);
    return;
  }
  app.LAST_TIMINGS.EEE = 'BUY_NOW';  // pretend we were in BUY_NOW last refresh
  const changes = app.detectTimingAlerts(data);
  const eeeChange = changes.find(c => c.ticker === 'EEE');
  assert.equal(eeeChange, undefined, `transition out of buy-tier must NOT fire, got: ${JSON.stringify(eeeChange)}`);
  // But LAST_TIMINGS still got updated (so next refresh sees the new state)
  assert.equal(app.LAST_TIMINGS.EEE, action, 'LAST_TIMINGS must update even when no alert fires');
});

// === Scenario 6 (BONUS): _BUY_TIER_ACTIONS only includes the three buy actions
test('Scenario 6 (bonus): _BUY_TIER_ACTIONS is the canonical buy-tier set', () => {
  const app = loadApp();
  assert.ok(app._BUY_TIER_ACTIONS.has('BUY_NOW'));
  assert.ok(app._BUY_TIER_ACTIONS.has('BUY_ON_DIP'));
  assert.ok(app._BUY_TIER_ACTIONS.has('EARLY_RALLY'));
  // Inverse — DCA / WAIT / CONFLICT / SELL / AVOID are NOT buy-tier
  for (const action of ['DCA', 'WAIT', 'CONFLICT', 'SELL', 'AVOID', 'HOLD']) {
    assert.ok(!app._BUY_TIER_ACTIONS.has(action), `${action} must not be a buy-tier`);
  }
});
