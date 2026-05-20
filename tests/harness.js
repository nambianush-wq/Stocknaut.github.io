// Test harness for index.html — loads the inline <script> block into a Node
// sandbox with a stubbed DOM/localStorage/fetch so pure-JS code paths (portfolio
// builders, forecast/verdict math, event synthesis) can be exercised headlessly.
//
// Usage from a test file:
//   const { loadApp } = require('./harness');
//   const app = loadApp();           // returns the populated global object
//   const p = app.buildPortfolioFromInvestor(10000, 0, 5);
//
// Why a sandbox and not jsdom: zero dependencies (project has no package.json
// and no build step — keeping it that way). The stubs only cover what the
// pure-logic paths actually touch; anything that needs a real browser (chart
// rendering, network) must be skipped or stubbed per-test.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX_HTML = path.join(__dirname, '..', 'index.html');

function buildStubElement() {
  const el = {
    _innerHTML: '',
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    appendChild() {}, removeChild() {}, replaceChild() {}, insertBefore() {},
    remove() {},
    addEventListener() {}, removeEventListener() {},
    querySelector: () => buildStubElement(),
    querySelectorAll: () => [],
    children: [], childNodes: [],
    scrollIntoView() {}, focus() {}, blur() {}, click() {},
    dataset: {}, parentNode: null, firstChild: null, lastChild: null,
    cloneNode: () => buildStubElement(),
    contains: () => false,
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    value: '',
  };
  Object.defineProperty(el, 'innerHTML', { get() { return el._innerHTML; }, set(v) { el._innerHTML = String(v); } });
  // textContent is read-write — needed by tests that observe label updates
  // (sidebar toggle, cockpit meta count, etc.).
  el._textContent = '';
  Object.defineProperty(el, 'textContent', { get() { return el._textContent; }, set(v) { el._textContent = String(v); } });
  return el;
}

function loadApp() {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const m = html.match(/<script>\r?\n([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Could not find inline <script> block in index.html');
  const js = m[1];

  const docEls = new Map();
  const sandbox = {};
  const ls = {
    _data: {},
    getItem(k) { return this._data[k] ?? null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; },
    get length() { return Object.keys(this._data).length; },
    key(i) { return Object.keys(this._data)[i]; },
  };
  sandbox.document = {
    getElementById(id) {
      if (!docEls.has(id)) docEls.set(id, buildStubElement());
      return docEls.get(id);
    },
    querySelector: () => buildStubElement(),
    querySelectorAll: () => [],
    createElement: () => buildStubElement(),
    body: buildStubElement(),
    documentElement: buildStubElement(),
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
  };
  sandbox.window = {
    addEventListener() {}, removeEventListener() {},
    location: { hostname: 'localhost', pathname: '/', href: 'http://localhost/' },
    localStorage: ls,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: (cb) => setImmediate(() => cb(performance.now())),
    cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    innerWidth: 1920, innerHeight: 1080,
    navigator: { userAgent: 'node' },
    performance,
    fetch: () => Promise.reject(new Error('fetch stub — tests must stub fetch per-case')),
    console,
    LightweightCharts: {
      createChart: () => ({
        remove() {}, applyOptions() {},
        addSeries: () => ({ setData() {}, createPriceLine() {}, applyOptions() {} }),
        addCandlestickSeries: () => ({ setData() {}, createPriceLine() {}, applyOptions() {} }),
        addLineSeries: () => ({ setData() {}, createPriceLine() {}, applyOptions() {} }),
        addHistogramSeries: () => ({ setData() {}, applyOptions() {} }),
        timeScale: () => ({ fitContent() {}, applyOptions() {} }),
        priceScale: () => ({ applyOptions() {} }),
        subscribeCrosshairMove() {}, unsubscribeCrosshairMove() {},
      }),
      CrosshairMode: { Normal: 1, Magnet: 2, Hidden: 3 },
      LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 },
      PriceLineSource: { LastBar: 0, LastVisible: 1 },
    },
  };
  sandbox.localStorage = ls;
  sandbox.location = sandbox.window.location;
  sandbox.navigator = sandbox.window.navigator;
  sandbox.requestAnimationFrame = sandbox.window.requestAnimationFrame;
  sandbox.cancelAnimationFrame = sandbox.window.cancelAnimationFrame;
  sandbox.matchMedia = sandbox.window.matchMedia;
  // ResizeObserver stub — used by chart panes after createChart() lands.
  sandbox.ResizeObserver = function () { return { observe() {}, unobserve() {}, disconnect() {} }; };
  // Minimal in-memory IndexedDB stub — drives the safety-net C restore-on-load
  // path so the helper can be exercised headlessly. Only implements open +
  // transaction + objectStore.get/put with a single 'kv' store.
  (function () {
    const dbState = { stores: new Map(), version: 0 };
    const dbHandle = {
      objectStoreNames: { contains: (n) => dbState.stores.has(n) },
      createObjectStore: (name) => { dbState.stores.set(name, new Map()); return {}; },
      transaction: (storeName) => {
        const tx = { oncomplete: null, onerror: null, onabort: null };
        tx.objectStore = () => ({
          put: (val, key) => {
            if (!dbState.stores.has(storeName)) dbState.stores.set(storeName, new Map());
            dbState.stores.get(storeName).set(key, val);
            setImmediate(() => { if (tx.oncomplete) tx.oncomplete({ target: tx }); });
            return {};
          },
          get: (key) => {
            const req = { result: undefined, onsuccess: null, onerror: null };
            setImmediate(() => {
              const store = dbState.stores.get(storeName);
              req.result = store ? store.get(key) : undefined;
              if (req.onsuccess) req.onsuccess({ target: req });
            });
            return req;
          },
        });
        return tx;
      },
    };
    sandbox.indexedDB = {
      open: (/* name, version */) => {
        const req = { result: dbHandle, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
        setImmediate(() => {
          if (dbState.version === 0) {
            dbState.version = 1;
            if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
          }
          if (req.onsuccess) req.onsuccess({ target: req });
        });
        return req;
      },
      // Helper for tests to wipe the in-memory IDB between cases
      _reset: () => { dbState.stores = new Map(); dbState.version = 0; },
    };
  })();
  sandbox.window.indexedDB = sandbox.indexedDB;
  sandbox.fetch = sandbox.window.fetch;
  sandbox.LightweightCharts = sandbox.window.LightweightCharts;
  sandbox.HTMLElement = function () {};
  sandbox.HTMLInputElement = function () {};
  sandbox.console = console;
  sandbox.performance = performance;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.setInterval = setInterval;
  sandbox.clearInterval = clearInterval;
  sandbox.setImmediate = setImmediate;
  sandbox.URL = URL;
  sandbox.URLSearchParams = URLSearchParams;
  sandbox.TextEncoder = TextEncoder;
  sandbox.TextDecoder = TextDecoder;

  // Whitelist of top-level identifiers tests need to reach. `const`/`let`
  // declarations don't become properties of the vm context, so we append an
  // export trailer that assigns each one to `globalThis` before returning.
  const exported = [
    // Builders + renderers
    'buildPortfolio', 'buildPortfolioFromInvestor', 'buildPortfolioFromSimSet',
    'renderWhatIfResults', 'renderHoldingCard', 'renderCalendarCard',
    'computeWhatIfMetrics', 'buildWhatIfCache',
    // Event synthesis
    'buildUpcomingEvents', 'buildCalendarSummary',
    // Pure math
    'computeVerdict', 'computeRiskMetrics', 'computeBeta', 'computeHHI',
    'buildForecast', 'computeBuyTiming', 'posNegFor', 'hhiLabel',
    // Data
    '_TOP_13F_INVESTORS', 'STRATEGY_DEFS', 'STOCK_CATALOG', 'ETF_ROLES',
    // Stubbable hooks
    'getEarningsDateCached', 'getBars', 'getMarketBars', 'getProfileFor',
    // Persistence
    'saveCurrentBundle', '_lastBuiltPortfolio', 'SAVED_BUNDLES',
    // Sim Set
    'SIM_SET',
    // Picker (pick-stocks-and-optimise) + segment alternatives + bundle ops
    '_PICKED_TICKERS', '_LAST_BUILD_ALTS',
    'buildPortfolioFromPicker', 'computeAndStashBuildAlternatives',
    'computeSegmentAlternativesForHolding',
    '_applyMoveToBundle', '_renormaliseBundle', 'computeBundleCorrections',
    // Sectors page tile rendering + filter state
    'renderTilesFromCache', 'selectGoal', '_sectorsFilters', '_currentGoal',
    'buildSectorsCache', '_applySectorsFilters', '_verdictTooltip',
    'renderPickRow', 'renderTimingChip',
    // Sidebar toggle (topbar)
    '_applyTopbarSidebarToggle', 'toggleSidebar', '_isCockpitSidebarCollapsed',
    'LS_KEY_COCKPIT_SIDEBAR',
    // Ticker dashboard
    'renderMain', 'selectTicker', '_selected', '_data',
    // Bars cache (RCA 2026-05-19)
    '_readCachedBars', '_writeCachedBars',
    'fetchTwelveDataPrice', 'renderCrossCheckChip', '_lastTdError',
    // Storage safety nets — IDB backup + recovery banner + export nudge (2026-05-19)
    '_idbOpen', '_idbPut', '_idbGet', '_IDB_BACKED_KEYS', 'IDB_DB_NAME', 'IDB_STORE',
    '_restoreFromIdbValue', 'restoreFromIdbOnBoot',
    '_isFreshDefaultState', '_DEFAULT_WL_FRESH',
    'showRecoveryBanner', 'LS_KEY_RECOVERY_DISMISSED',
    'stampLastExport', 'maybeShowExportNudge', '_shouldShowExportNudge',
    'LS_KEY_LAST_EXPORT', 'LS_KEY_EXPORT_NUDGE_DISMISSED',
    'LS_KEY_WL', 'LS_KEY_FAVS', 'LS_KEY_SIMSET', 'LS_KEY_BUNDLES',
    'LS_KEY_WL_BACKUP', 'LS_KEY_FAVS_BACKUP', 'LS_KEY_SIMSET_BACKUP', 'LS_KEY_BUNDLES_BACKUP',
    'WATCHLIST', 'FAVORITES', 'SIM_SET',
    'importKeysFromFile', 'exportKeys',
    // Cockpit + live data
    '_cockpitRenderHeatmap', '_cockpitComputeOverview',
    'fetchTickerBundle', 'fetchBars', 'fetchQuote', 'fetchFinnhubProfile', 'fetchFinnhubMetrics',
    'fetchYahooWeekly', 'fetchTwelveDataWeekly',
    'isLive', 'fmt', 'API_KEY', 'TD_API_KEY',
    // AI / LLM helpers (2026-05-19 leaked-key RCA — smoke needs to invoke
    // callLLM with a stubbed fetch to exercise the error classifier)
    'callLLM', 'hasLLM', 'GEMINI_API_KEY', 'LS_KEY_GEMINI',
  ];
  const exportTrailer = ';(' + exported.map(n =>
    `(typeof ${n} !== 'undefined') && (globalThis.${n} = ${n})`
  ).join(',') + ');';

  vm.createContext(sandbox);
  vm.runInContext(js + exportTrailer, sandbox, { filename: 'index.html-inline' });
  return sandbox;
}

module.exports = { loadApp };
