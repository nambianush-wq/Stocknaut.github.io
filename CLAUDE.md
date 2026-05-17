# StockPulse — Project Instructions

Single-file dark-themed stock analysis dashboard. Vanilla HTML/CSS/JS, no build step, no framework. The whole app lives in `index.html` (~770 KB+).

---

## CRITICAL — Always mirror commits to BOTH remotes (2026-05-16, repo renamed 2026-05-17)

Every git commit MUST be pushed to both:
- `origin` → `https://github.com/nambianush-wq/Stock-Pulse.git` (development repo)
- `stocknaut` → `https://github.com/nambianush-wq/stockpulse.git` (live-hosting repo, GitHub Pages serves it at https://nambianush-wq.github.io/stockpulse/)

**Live URL:** https://nambianush-wq.github.io/stockpulse/

**Repo history note:** the public-hosting repo was originally `Stocknaut.github.io` (URL was `https://nambianush-wq.github.io/Stocknaut.github.io/` — ugly because GitHub treats it as a project repo and prepends user-namespace). Renamed to `stockpulse` 2026-05-17 to get a cleaner URL. GitHub auto-redirects the old URL for ~6 months, but every reference in the codebase + bookmarks should use the new URL. The git remote NAME stays `stocknaut` (renaming the local alias would require resetting every project doc) — only the URL changed.

**Why:** The public-hosting repo is the URL the user shares with others. Falling behind on it means viewers see stale code.

**How:** After EVERY commit, run BOTH:
```bash
git push                       # pushes to origin (default)
git push stocknaut main        # mirrors to stocknaut (URL now points at stockpulse)
```

This is a hard rule — never push to only one remote.

The `stocknaut` remote was originally set up as a force-push (the destination repo had a placeholder welcome README that got overwritten). Subsequent pushes are normal fast-forwards — no force needed unless histories diverge again.

---

## File location

`C:\Users\anush.nambi\OneDrive - Accenture\DESKTOP\CLAUDE CODE\CLAUDE AGENTS\STOCK PULSE\index.html`

OneDrive is sync-managed. The folder previously had an underscore name (`STOCK_PULSE`) that OneDrive renamed mid-session to `STOCK PULSE` (with a space), losing the file in the process. The recovery flow was: user saved the running browser tab as `Index.html`, we renamed to lowercase, restored the CDN script reference, initialized git. Result: `index.html` is now under git control, so future OneDrive sync hiccups can't lose progress.

**Implication:** keep committing aggressively. Every feature batch gets its own commit + dual-remote push.

---

## Architecture

- **Single file**: `index.html` — HTML + CSS + JS all inline. No bundler, no dependencies beyond the lightweight-charts CDN.
- **Charts**: [TradingView lightweight-charts](https://github.com/tradingview/lightweight-charts) loaded from `unpkg.com`. Restore the CDN script tag (line ~7) if a browser save replaces it with a local copy.
- **Storage**: localStorage for watchlist, settings, favorites, sim set, saved bundles, API keys.
- **API keys**: stored in two localStorage slots (primary + backup) for resilience. Export/import to a `.txt` file is available in Settings.

---

## Edit discipline

- **Find anchors first.** The file is large; use `Grep` to locate unique anchors before `Edit`. Don't search blindly with broad regexes.
- **Verify the JS template, not the static HTML.** The browser-saved DOM (lines ~2500-9000) is leftover render output from a previous session. The LIVE templates that drive the app live in JS template strings further down (lines ~10000+). Always edit the JS template — the static HTML gets replaced on first render.
- **Syntax-check before commit.** Use the awk pipeline to extract inline JS and run `node --check`:
  ```bash
  awk '/<script>$/,/<\/script>/' index.html | sed '1d;$d' > /tmp/sp.js && node --check /tmp/sp.js
  ```
- **No emojis as icons.** The skill `/ui-ux-pro-max` clarified this. Use SVG, Unicode symbols (★ +), or text labels.
- **Tooltip discipline.** Every indicator gets a `title=` attribute referencing the central `TIP` dictionary (`TIP[key]` via `tip(key)` helper). Every tooltip must include a "What this means" section in plain English for non-finance users.

---

## Commit message style

Pattern: short imperative subject line + multi-line body explaining the WHY, the WHAT, and the LAYERS touched (CSS / HTML / JS / state / persistence).

Examples:
- `Stage A: Save simulation bundles with daily/cumulative P&L tracking`
- `Round 1: tile-overlap fix + news error visibility + Stage C (Build from Sim Set)`
- `API keys: resilient persistence + backup slot + export/import`

Avoid generic "update", "fix", "add features" subjects — those carry no information at a glance.

---

## Key feature areas (current as of 2026-05-16)

| Tab | Owns |
|---|---|
| Cockpit | (in progress) real-time dashboard for the whole watchlist |
| Watchlist | Per-ticker analysis: verdict, charts, exec summary, news, forecasts, peer card |
| Sectors | 5-goal investment ranking + tile grid w/ 1Y/3Y/5Y history + 12/24/36M forecast |
| Top Picks | 100 best Buy candidates grouped by sector w/ mood color-coded jump bar |
| What If | Portfolio builder + risk metrics + saved bundles w/ daily P&L tracking + Modify modal |

Cross-cutting:
- Heat scale (thermal palette) — applied everywhere a ticker appears
- Favorites + Sim Set state (LS-persisted, sync between Watchlist/Sectors/Top Picks)
- Twelve Data cross-check (secondary provider, 60s cache)
- Verify-on outbound links (Yahoo, TradingView, StockCharts, Google Finance, Analyst forecast)
- Layman tooltips on every indicator (central TIP dictionary)
- News card with Finnhub /company-news + sentiment heuristic + error visibility

---

## Honest limitations

- Forecasts are heuristic (heat score + volatility band + horizon decay). Not predictive.
- Cross-check requires Twelve Data key. Without it, Finnhub is the sole source.
- Verdict score scale (-100 to +100) is a composite — directional indicator only.
- Daily snapshot tracking only fires when the What If tab is visited. If user skips What If for a week, history has gaps.
- News sentiment is keyword-based (no LLM). Catches obvious patterns; misses subtle context.
- Headless unit tests live in `tests/` and run via `node --test tests/investor_clone.test.js` (zero deps — Node's built-in test runner + a vm sandbox that loads the inline `<script>` from `index.html`). Pure-JS paths (builders, forecast/verdict math, event synthesis) are covered; layout, paint, real charts, and real network still need manual UI verification.
