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
  Object.defineProperty(el, 'textContent', { get() { return ''; }, set(_v) {} });
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
    LightweightCharts: { createChart: () => ({ remove() {}, addSeries() {}, applyOptions() {} }) },
  };
  sandbox.localStorage = ls;
  sandbox.location = sandbox.window.location;
  sandbox.navigator = sandbox.window.navigator;
  sandbox.requestAnimationFrame = sandbox.window.requestAnimationFrame;
  sandbox.cancelAnimationFrame = sandbox.window.cancelAnimationFrame;
  sandbox.matchMedia = sandbox.window.matchMedia;
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
  ];
  const exportTrailer = ';(' + exported.map(n =>
    `(typeof ${n} !== 'undefined') && (globalThis.${n} = ${n})`
  ).join(',') + ');';

  vm.createContext(sandbox);
  vm.runInContext(js + exportTrailer, sandbox, { filename: 'index.html-inline' });
  return sandbox;
}

module.exports = { loadApp };
