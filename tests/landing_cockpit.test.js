// Regression: on page load the FIRST view shown must be 'cockpit', and this must
// happen BEFORE refreshAll() resolves. The 2026-05-17 regression was that
// showView('cockpit') was placed AFTER `await refreshAll(true)` in init() — in
// LIVE mode refreshAll takes several seconds (sequential per-ticker fetch), and
// the user saw the static-HTML Watchlist tab with "Loading <ticker>..." for the
// whole duration. This test slows refreshAll deliberately and asserts that
// showView('cockpit') has already fired before refreshAll resolves.
//
// Also asserts the static HTML: the Cockpit tab must carry class="tab active"
// and aria-selected="true" so the pre-JS paint matches the post-JS state and
// there's no visible flicker.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness');

const INDEX_HTML = path.join(__dirname, '..', 'index.html');

test('static HTML — Cockpit tab is the initial active tab', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const cockpitTab = html.match(/<button class="tab[^"]*" data-view="cockpit"[^>]*>/);
  const watchlistTab = html.match(/<button class="tab[^"]*" data-view="watchlist"[^>]*>/);
  assert.ok(cockpitTab, 'cockpit tab not found in static HTML');
  assert.ok(watchlistTab, 'watchlist tab not found in static HTML');
  assert.match(cockpitTab[0], /class="tab active"/, 'cockpit tab must start as active');
  assert.match(cockpitTab[0], /aria-selected="true"/, 'cockpit tab must start aria-selected=true');
  assert.doesNotMatch(watchlistTab[0], /class="tab active"/, 'watchlist tab must NOT start active');
  assert.doesNotMatch(watchlistTab[0], /aria-selected="true"/, 'watchlist tab must NOT start aria-selected=true');
});

test('init() — showView("cockpit") fires BEFORE await refreshAll resolves', async () => {
  const app = loadApp();
  // Order log: every showView call gets pushed, every refreshAll start/end gets pushed
  const order = [];

  // Replace WATCHLIST with a single deterministic ticker so the rest of init
  // does not blow up on an empty watchlist (which short-circuits refreshAll).
  app.WATCHLIST = ['AAPL'];

  // Spy on showView while preserving the real implementation enough to set
  // _currentView (init() reads _currentView after the await).
  const realShowView = app.showView;
  app.showView = function (view) {
    order.push('showView:' + view);
    // Mirror the side-effect the post-await guard relies on
    app._currentView = view;
    // Don't actually call realShowView — it touches the DOM heavily and our
    // sandbox stub is minimal. We only care about call ordering here.
  };

  // Stub refreshAll to be a controllable long-running promise. The deferred
  // resolve simulates LIVE-mode sequential fetch latency.
  let resolveRefresh;
  app.refreshAll = function () {
    order.push('refreshAll:start');
    return new Promise((res) => {
      resolveRefresh = () => { order.push('refreshAll:end'); res(); };
    });
  };

  // Stub anything else init() touches that's not load-bearing for this test.
  app.refreshAll13FFreshness = async () => {};
  app.renderCockpit = () => { order.push('renderCockpit'); };
  app.renderWatchlist = () => {};
  app.renderMain = () => {};
  app.requestNotificationPermission = () => {};
  app.startRefreshTimer = () => {};
  app.notifyChanges = () => {};
  app.syncFavoritesToWatchlist = () => 0;
  app.updateSidebarCounters = () => {};
  app.updateVerdictFilterPills = () => {};
  app.updateTypeFilterPills = () => {};
  app.updateTimingFilterPills = () => {};
  app.updateInstFilterPills = () => {};
  app.setCockpitAutoRefresh = () => {};
  app.updateModeIndicators = () => {};
  app._injectPageDisclaimers = () => {};
  app.showToast = () => {};

  // Re-bind the harness's globals so the closure inside init() resolves to our spies.
  // The init function is declared with `async function init()` and captures the
  // identifiers `showView`, `refreshAll`, etc. via lexical scope of the script.
  // Because the vm context's globals ARE the lexical environment for declarations
  // at the script top level, reassigning on the sandbox global works.

  const initPromise = app.init();

  // Flush microtasks twice so the synchronous prefix of init() (everything up to
  // the first await) gets to run.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  // BEFORE we let refreshAll resolve, the order log MUST already contain showView:cockpit
  // AND refreshAll:start.
  const beforeResolveSnap = order.slice();
  resolveRefresh();
  await initPromise;

  // Assertions
  const showViewIdx = beforeResolveSnap.indexOf('showView:cockpit');
  const refreshStartIdx = beforeResolveSnap.indexOf('refreshAll:start');

  assert.ok(showViewIdx !== -1,
    'showView("cockpit") was not called before refreshAll resolved. Order log: ' + JSON.stringify(beforeResolveSnap));
  assert.ok(refreshStartIdx !== -1,
    'refreshAll never started. Order log: ' + JSON.stringify(beforeResolveSnap));
  assert.ok(showViewIdx < refreshStartIdx,
    'showView("cockpit") must run BEFORE refreshAll starts. Order log: ' + JSON.stringify(beforeResolveSnap));
});
