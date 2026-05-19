// Sidebar-toggle button: label + tooltip + aria-pressed must stay in sync with
// the collapsed state. User-reported 2026-05-19: hovering the "Show sidebar"
// button revealed a tooltip saying "Hide the watchlist sidebar..." — contra-
// diction. The label was state-sync'd via _applyTopbarSidebarToggle() but the
// tooltip was set ONCE in static HTML and never updated.
//
// Five scenarios (anush-rca Phase 4.5):

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

function getBtnState(app) {
  const btn   = app.document.getElementById('sidebar-toggle-btn');
  const label = app.document.getElementById('sidebar-toggle-label');
  const icon  = app.document.getElementById('sidebar-toggle-icon');
  return {
    aria:  btn   && btn._attrs && btn._attrs['aria-pressed'],
    title: btn   && btn.title,
    label: label && label.textContent,
    icon:  icon  && icon.textContent,
  };
}

// The harness stub element doesn't expose setAttribute/title by default —
// patch it minimally so the test can observe the call results.
function patchStubFor(app) {
  const orig = app.document.getElementById;
  app.document.getElementById = function (id) {
    const el = orig.call(this, id);
    if (el && !el._sidebarPatched) {
      el._attrs = el._attrs || {};
      const origSet = el.setAttribute;
      el.setAttribute = function (k, v) { el._attrs[k] = v; if (origSet) origSet.call(el, k, v); };
      // title is a plain property on stub elements — already settable.
      el._sidebarPatched = true;
    }
    return el;
  };
}

// === Scenario 1 (VERBATIM): collapsed → label "Show sidebar" AND title says "Show" (NOT "Hide") ===
test('Scenario 1 (verbatim): collapsed state → tooltip + label both say "Show", never "Hide"', () => {
  const app = loadApp();
  patchStubFor(app);
  // Force collapsed = true
  app.localStorage.setItem('sp_cockpit_sidebar_collapsed', 'true');
  app._applyTopbarSidebarToggle();
  const s = getBtnState(app);
  assert.match(s.label || '', /Show sidebar/i, `label should say "Show sidebar", got: '${s.label}'`);
  assert.match(s.title || '', /Show the watchlist sidebar/i, `title should mention "Show", got: '${s.title}'`);
  assert.doesNotMatch(s.title || '', /Hide the watchlist sidebar/i, `title must NOT say "Hide" when collapsed: '${s.title}'`);
});

// === Scenario 2 (INVERSE): visible → label "Hide sidebar" AND title says "Hide" ===
test('Scenario 2 (inverse): visible state → tooltip + label both say "Hide", never "Show"', () => {
  const app = loadApp();
  patchStubFor(app);
  app.localStorage.setItem('sp_cockpit_sidebar_collapsed', 'false');
  app._applyTopbarSidebarToggle();
  const s = getBtnState(app);
  assert.match(s.label || '', /Hide sidebar/i, `label should say "Hide sidebar", got: '${s.label}'`);
  assert.match(s.title || '', /Hide the watchlist sidebar/i, `title should mention "Hide", got: '${s.title}'`);
  assert.doesNotMatch(s.title || '', /Show the watchlist sidebar to bring/i, `title must NOT say "Show...bring" when visible`);
});

// === Scenario 3 (SIBLING): aria-pressed flips with state ===
test('Scenario 3 (sibling): aria-pressed correctly tracks collapsed state', () => {
  const app = loadApp();
  patchStubFor(app);
  app.localStorage.setItem('sp_cockpit_sidebar_collapsed', 'true');
  app._applyTopbarSidebarToggle();
  assert.equal(getBtnState(app).aria, 'true', 'aria-pressed must be "true" when collapsed');
  app.localStorage.setItem('sp_cockpit_sidebar_collapsed', 'false');
  app._applyTopbarSidebarToggle();
  assert.equal(getBtnState(app).aria, 'false', 'aria-pressed must be "false" when visible');
});

// === Scenario 4 (EDGE): toggle round-trip — collapsed → visible → collapsed produces clean state ===
test('Scenario 4 (edge): toggle round-trip keeps label + title in sync at every step', () => {
  const app = loadApp();
  patchStubFor(app);
  // Start visible
  app.localStorage.setItem('sp_cockpit_sidebar_collapsed', 'false');
  app._applyTopbarSidebarToggle();
  let s = getBtnState(app);
  assert.match(s.label, /Hide/i);
  assert.match(s.title, /Hide the watchlist/i);
  // Toggle to collapsed
  app.toggleSidebar();
  s = getBtnState(app);
  assert.match(s.label, /Show/i, 'after toggle: label should be Show');
  assert.match(s.title, /Show the watchlist/i, 'after toggle: title should be Show');
  // Toggle back to visible
  app.toggleSidebar();
  s = getBtnState(app);
  assert.match(s.label, /Hide/i, 'after 2nd toggle: label back to Hide');
  assert.match(s.title, /Hide the watchlist/i, 'after 2nd toggle: title back to Hide');
});

// === Scenario 5 (CROSS-SCOPE): only ONE sidebar-toggle button exists in the static HTML ===
// Pin against the 2026-05-19 "two buttons on the page" screenshot. The user's
// screenshot was stale browser cache, but the contract going forward is: the
// codebase shall not emit a second sidebar-toggle button anywhere. If a future
// commit reintroduces `id="cockpit-sidebar-btn"` as a real HTML button, this
// test fires.
test('Scenario 5 (cross-scope): exactly one sidebar-toggle button in static HTML', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  // Count <button ... id="sidebar-toggle-btn" ...> AND <button ... id="cockpit-sidebar-btn" ...>
  const topbarMatches = html.match(/<button[^>]+id="sidebar-toggle-btn"/g) || [];
  const cockpitMatches = html.match(/<button[^>]+id="cockpit-sidebar-btn"/g) || [];
  assert.equal(topbarMatches.length, 1, `expected exactly 1 sidebar-toggle-btn button, got ${topbarMatches.length}`);
  assert.equal(cockpitMatches.length, 0, `expected 0 cockpit-sidebar-btn buttons (deprecated/unused), got ${cockpitMatches.length}`);
});
