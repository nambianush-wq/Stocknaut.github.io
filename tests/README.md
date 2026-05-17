# StockPulse — tests

Zero-dependency TDD harness using Node's built-in test runner (`node:test`). The
single-file app stays single-file: tests live next door, load the inline
`<script>` block from `index.html` into a stubbed DOM sandbox, then exercise
pure-JS paths headlessly.

## Run

```bash
node --test tests/
```

Requires Node 18+ (uses `node:test`). No `npm install`, no build step, no
package.json needed.

## Files

- `harness.js` — extracts the inline `<script>` from `index.html` and evaluates
  it in a `vm` context with minimal stubs for `document`, `window`,
  `localStorage`, `fetch`, `requestAnimationFrame`, and `LightweightCharts`.
  Returns the populated global so tests can grab any function declared in the
  app (`buildPortfolio`, `computeVerdict`, `buildUpcomingEvents`, etc.).
- `investor_clone.test.js` — locks in the fix for the `h is not defined` crash
  on the investor-clone path (LIVE earnings + dividend-paying ticker). Also
  exercises every baked 13F manager and every goal-based portfolio.

## TDD discipline

For each new bug fix or feature: add a failing test first that reproduces the
issue (or asserts the new behaviour), then change `index.html` until it passes.
The harness re-reads `index.html` from disk each `loadApp()` call, so there's
no caching gotcha — edit-save-rerun is the loop.

The harness can't cover layout, paint, real charts, real network — anything
visual still needs the manual checklist in CLAUDE.md.
