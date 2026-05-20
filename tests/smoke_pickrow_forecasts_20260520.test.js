// renderPickRow forecasts strip — 4 inline cells, not details/summary disclosure.
//
// RCA 2026-05-20: Sectors page showed an asymmetric forecast strip — 3-year
// history + 12-month rendered as 2 cells in a 4-column grid, then a "+2 longer
// ▾" <details> toggle held 24M + 36M stacked vertically *inside* a single
// grid column instead of spanning the leftover columns. Result: weird,
// off-balance layout that doesn't match the rest of the dashboard's chart
// styling.
//
// Fix: render ALL horizons inline — exactly 4 cells (history + 12M + 24M +
// 36M) matching the 4-column grid. Drop the details disclosure entirely.
// Drop the confidence progress-bar from each card (visual noise; the colored
// % return + tooltip already carry the signal).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

function buildPickMetric(overrides) {
  const base = {
    ticker: 'TEST',
    name: 'Test Corp',
    last: 100.00,
    wkChange: 1.5,
    monthChange: 5.0,
    threeMoChange: 10.0,
    lastRsi: 55.5,
    score: 65,
    verdict: 'BUY',
    forecasts: [
      { months: 12, expReturn: 8.5, expPrice: 108.50, confidence: 60 },
      { months: 24, expReturn: 18.0, expPrice: 118.00, confidence: 45 },
      { months: 36, expReturn: 28.0, expPrice: 128.00, confidence: 32 },
    ],
    history: {
      periodReturn: 35.2,
      maxDd: -22.4,
      sparkSamples: Array.from({ length: 52 }, (_, i) => 100 + Math.sin(i / 8) * 10),
    },
    historyYears: 3,
  };
  return Object.assign(base, overrides || {});
}

// === Scenario 1 (VERBATIM): full data → 4 inline forecast cells, NO <details>
test('Scenario 1 (verbatim): full forecast set renders 4 inline cells, no <details>', () => {
  const app = loadApp();
  const html = app.renderPickRow(buildPickMetric(), 1);
  // Count .pick-fc cards inside .pick-forecasts (history + 12M + 24M + 36M = 4)
  // Match the cell containers only — `class="pick-fc "` (with trailing space)
  // or `class="pick-fc pick-fc-history"`. Skips inner classes (pick-fc-h,
  // pick-fc-pct, pick-fc-px) which all start with "pick-fc-".
  const fcCount = (html.match(/class="pick-fc(?:[ "]|\s+pick-fc-history)/g) || []).length;
  assert.equal(fcCount, 4, `expected 4 forecast cells inline, got ${fcCount}. HTML: ${html.slice(0, 400)}`);
  assert.doesNotMatch(html, /<details/, 'expected no <details> disclosure');
  assert.doesNotMatch(html, /pick-fc-longer/, 'expected no pick-fc-longer class');
  assert.doesNotMatch(html, /longer ▾/, 'expected no "+N longer ▾" label');
});

// === Scenario 2 (INVERSE): cards appear in ascending-horizon order =========
test('Scenario 2 (inverse): forecast cells render in ascending horizon order', () => {
  const app = loadApp();
  // Deliberately give forecasts in REVERSE order — render must sort them
  const m = buildPickMetric({
    forecasts: [
      { months: 36, expReturn: 28.0, expPrice: 128.00, confidence: 32 },
      { months: 24, expReturn: 18.0, expPrice: 118.00, confidence: 45 },
      { months: 12, expReturn: 8.5,  expPrice: 108.50, confidence: 60 },
    ],
  });
  const html = app.renderPickRow(m, 1);
  const idx12 = html.indexOf('12-Month');
  const idx24 = html.indexOf('24-Month');
  const idx36 = html.indexOf('36-Month');
  assert.ok(idx12 >= 0 && idx24 >= 0 && idx36 >= 0, 'all three horizon labels must be present');
  assert.ok(idx12 < idx24 && idx24 < idx36, `expected 12M < 24M < 36M order; got ${idx12} ${idx24} ${idx36}`);
});

// === Scenario 3 (SIBLING): single-horizon forecast → still renders cleanly =
test('Scenario 3 (sibling): single-horizon forecast renders 1 cell + history', () => {
  const app = loadApp();
  const m = buildPickMetric({
    forecasts: [{ months: 12, expReturn: 8.5, expPrice: 108.50, confidence: 60 }],
  });
  const html = app.renderPickRow(m, 1);
  // Match the cell containers only — `class="pick-fc "` (with trailing space)
  // or `class="pick-fc pick-fc-history"`. Skips inner classes (pick-fc-h,
  // pick-fc-pct, pick-fc-px) which all start with "pick-fc-".
  const fcCount = (html.match(/class="pick-fc(?:[ "]|\s+pick-fc-history)/g) || []).length;
  // history + 12M = 2
  assert.equal(fcCount, 2, `expected 2 cells (history + 12M), got ${fcCount}`);
  assert.doesNotMatch(html, /<details/, 'still no details disclosure');
});

// === Scenario 4 (EDGE): no history → renders only forecast cells, no crash =
test('Scenario 4 (edge): missing history renders forecasts only (no crash)', () => {
  const app = loadApp();
  const m = buildPickMetric({ history: null });
  const html = app.renderPickRow(m, 1);
  // 3 forecast cells, no history
  // Match the cell containers only — `class="pick-fc "` (with trailing space)
  // or `class="pick-fc pick-fc-history"`. Skips inner classes (pick-fc-h,
  // pick-fc-pct, pick-fc-px) which all start with "pick-fc-".
  const fcCount = (html.match(/class="pick-fc(?:[ "]|\s+pick-fc-history)/g) || []).length;
  assert.equal(fcCount, 3, `expected 3 cells (forecasts only), got ${fcCount}`);
  assert.doesNotMatch(html, /pick-fc-history/, 'no history cell when history is null');
  assert.doesNotMatch(html, /Year History/, 'no history label when history is null');
});

// === Scenario 5 (CROSS-SCOPE): the dropped pieces — no progress bar, no toggle
test('Scenario 5 (cross-scope): no confidence progress bar; confidence shown via tooltip', () => {
  const app = loadApp();
  const html = app.renderPickRow(buildPickMetric(), 1);
  // The old visual-noise progress bar is gone
  assert.doesNotMatch(html, /pick-fc-conf/, 'confidence progress-bar should NOT render in the cell');
  assert.doesNotMatch(html, /<div class="bar">/, 'no inline bar div for confidence');
  // Confidence is still discoverable on hover — title carries it
  assert.match(html, /Confidence 60%/, 'confidence must appear in the 12M cell tooltip');
  assert.match(html, /Confidence 45%/, 'confidence must appear in the 24M cell tooltip');
  assert.match(html, /Confidence 32%/, 'confidence must appear in the 36M cell tooltip');
});
