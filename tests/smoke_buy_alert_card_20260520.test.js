// Buy-alert card visual layer — slide-in card, tier-colored accent, ticker
// badge, sparkline, Snooze 1h / Open / × actions, draining progress bar.
// Replaces the prior plain toast for buy-timing alerts.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

// === Scenario 1 (VERBATIM): BUY_NOW card produces tier-now class + correct copy
test('Scenario 1 (verbatim): BUY_NOW card carries tier-now class, action label, badge', () => {
  const app = loadApp();
  const html = app._buildBuyAlertCardHtml({ ticker: 'NVDA', from: '-', to: 'BUY_NOW' });
  assert.match(html, /buy-alert-action.*Buy now window opened/);
  assert.match(html, /class="buy-alert-badge"[^>]*>NVDA</);
  assert.match(html, /data-act="dismiss"/, 'dismiss × button must exist');
  assert.match(html, /data-act="snooze"/, 'Snooze 1h button must exist');
  assert.match(html, /data-act="open"/,   'Open button must exist');
  assert.match(html, /buy-alert-progress/,'draining progress bar must exist');
  // Ticker classification for BUY_NOW = tier-now (no extra modifier)
  assert.equal(app._buyAlertTierClass('BUY_NOW'), 'tier-now');
});

// === Scenario 2 (INVERSE): per-tier class mapping for the three buy actions ==
test('Scenario 2 (inverse): tier classes are distinct for BUY_NOW / BUY_ON_DIP / EARLY_RALLY', () => {
  const app = loadApp();
  assert.equal(app._buyAlertTierClass('BUY_NOW'),     'tier-now');
  assert.equal(app._buyAlertTierClass('BUY_ON_DIP'),  'tier-dip');
  assert.equal(app._buyAlertTierClass('EARLY_RALLY'), 'tier-early');
  // Non-buy actions fall back to tier-now (safe default, never rendered)
  assert.equal(app._buyAlertTierClass('WAIT'),    'tier-now');
  assert.equal(app._buyAlertTierClass('CONFLICT'),'tier-now');
});

// === Scenario 3 (SIBLING): snooze round-trip suppresses re-fire ===========
test('Scenario 3 (sibling): snoozed ticker is suppressed by _isSnoozed', () => {
  const app = loadApp();
  assert.equal(app._isSnoozed('AAPL'), false, 'no snooze set → not snoozed');
  app.snoozeBuyAlert('AAPL');
  assert.equal(app._isSnoozed('AAPL'), true, 'after snooze → snoozed');
  // Other tickers unaffected
  assert.equal(app._isSnoozed('MSFT'), false, 'snoozing AAPL must not affect MSFT');
  // Persistence — snooze map written to LS
  const raw = app.localStorage.getItem(app.LS_KEY_BUY_SNOOZE) || '';
  assert.ok(raw.includes('AAPL'), `expected snooze map to persist AAPL, got: ${raw}`);
});

// === Scenario 4 (EDGE): snoozed ticker is filtered out of notifyTimingChanges
test('Scenario 4 (edge): notifyTimingChanges skips snoozed tickers', () => {
  const app = loadApp();
  // Snooze GOOG before any alert fires
  app.snoozeBuyAlert('GOOG');
  // Count showBuyAlertCard invocations by stubbing
  let cardsShown = [];
  app.showBuyAlertCard = (c) => { cardsShown.push(c.ticker); return null; };
  app.notifyTimingChanges([
    { ticker: 'GOOG', from: '-', to: 'BUY_NOW' },
    { ticker: 'AAPL', from: '-', to: 'BUY_NOW' },
  ]);
  assert.deepEqual(cardsShown, ['AAPL'], `expected only AAPL to surface (GOOG snoozed), got: ${cardsShown}`);
});

// === Scenario 5 (CROSS-SCOPE): HTML escaping guards against XSS in tickers ==
test('Scenario 5 (cross-scope): ticker text is HTML-escaped (no XSS)', () => {
  const app = loadApp();
  // A malicious ticker — exotic but defensive coding matters here
  const html = app._buildBuyAlertCardHtml({ ticker: '<script>x</script>', from: '-', to: 'BUY_NOW' });
  assert.doesNotMatch(html, /<script>x<\/script>/, 'raw script tag must NOT appear in output');
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/, 'ticker must be HTML-escaped');
});

// === Scenario 6 (BONUS): expired snooze is auto-cleared on next check ======
test('Scenario 6 (bonus): expired snooze is auto-cleared by _isSnoozed', () => {
  const app = loadApp();
  // Backdate a snooze to 2h ago (BUY_SNOOZE_MS is 1h)
  app.BUY_SNOOZE.OLD = Date.now() - (2 * 60 * 60 * 1000);
  assert.equal(app._isSnoozed('OLD'), false, 'expired snooze must report not-snoozed');
  // Also pruned from the map
  assert.equal(app.BUY_SNOOZE.OLD, undefined, 'expired entry must be deleted on read');
});
