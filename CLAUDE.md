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

## AI features — where they live (2026-05-19, Gemini removed 2026-05-20)

StockPulse has two on-demand Groq-powered surfaces on the ticker dashboard:

- **"✦ Why this verdict?"** button in the verdict card → narrates the heat-score signals + recent news in plain English (3-4 sentences).
- **"✦ Resolve this conflict"** button under the timing card, shown only when `computeBuyTiming()` returns `CONFLICT` → suggests a concrete posture (DCA / wait / skip).

**Both gated on `hasLLM()`** — when no Groq key is present and the in-browser fallback isn't enabled, buttons hide and the app behaves identically.

**Provider chain (callLLM dispatcher):** `cache → Groq → in-browser local (Qwen2.5-0.5B)`

Gemini was added 2026-05-19, repeatedly hit key-revocation issues (the public-Pages URL got Google's secret-scanner to revoke any baked key within minutes; even personal keys ran into project-quota=0 once Google flagged a project), and was removed entirely 2026-05-20. Groq fills the same niche with sub-second responses, higher RPM, and Llama 3.3 70B quality.

**Key code anchors:**
- `callLLM(prompt, opts)` — provider-agnostic dispatcher. Tries Groq if a key is set and not dead-cached, falls back to local. Returns `{ok, text, error}`. The provider chain is built per-call so adding a new provider is one line.
- `_callGroqLLM(prompt, opts)` — Groq endpoint (`api.groq.com/openai/v1/chat/completions`, OpenAI-compatible). Streams via standard SSE `data: {...}\n\n` chunks with `choices[0].delta.content`.
- `callLocalLLM(prompt, opts)` — transformers.js + Qwen2.5-0.5B-Instruct, lazy-loaded on first use (~400 MB, cached in IndexedDB forever).
- `_aiContextSnapshot(ticker)` — compact factual block (verdict + signals + 12M forecast + timing + last 5 headlines) consumed by both prompt builders.
- `_aiPromptForVerdict(ctx)` / `_aiPromptForConflict(ctx)` — prompt templates. One place to audit / iterate prompt wording.
- `whyVerdict(ticker)` / `resolveConflict(ticker)` — UI handlers wired via inline `onclick=`. Render into a body-level `#ai-modal` so they survive `renderMain()` re-paints from async fetch completions.
- TIP dictionary entries `whyVerdict` + `resolveConflict` carry the layman-language tooltips.
- `_SP_BAKED_KEYS` — must NOT carry any LLM provider slot. See "Why LLM keys cannot be baked publicly" below.
- `LS_KEY_GROQ` + `LS_KEY_GROQ_BACKUP` — dual-slot per-browser persistence (personal keys, safe — stay local).
- `LS_KEY_GEMINI` + `LS_KEY_GEMINI_BACKUP` — legacy slots, kept declared so import paths for old backups don't crash. No active read or write.
- 24h per-`(ticker · day · verdict-score)` localStorage cache (`sp_llm_cache:` prefix) — repeat clicks cost zero tokens.
- Dead-key cache (`sp_gemini_dead_keys` — legacy LS slot name, now holds Groq fingerprints too via `_isRemoteKeyDead('groq', key)`) — provider-scoped, 24h TTL.

**Commit history note (search-aid):** the AI module was inadvertently bundled into commit `0e5e06c` ("RCA: Sidebar-toggle tooltip stale-state") because the parallel sidebar-tooltip fix was committed via `git commit -a` while the AI work was uncommitted in the working tree. The follow-up commit `19a9efa` ("AI features: ...") added only the baked Gemini key + status-display parity, hence its small diff. `git log -S 'function callLLM' -- index.html` is the reliable way to find when the module landed. Gemini was removed in the 2026-05-20 commit ("Remove Gemini, keep Groq as the only remote LLM").

---

## Why LLM keys CANNOT be baked publicly (2026-05-19 RCA, generalised 2026-05-20)

**Rule:** `_SP_BAKED_KEYS` must NOT carry any LLM provider slot. Personal keys go in Settings only. This rule applies to Gemini, Groq, Anthropic, OpenAI, OpenRouter, Mistral, Cohere — every commercial LLM provider operates an active scanner that revokes leaked keys, often within minutes.

**Original incident (Gemini, 2026-05-19):** a baked Gemini API key was committed (`19a9efa`) and pushed to both public remotes. Within ~30 minutes Google's secret-scanner detected it on the public GitHub repo + Pages URL and revoked it. The user's very first click of "Why this verdict?" hit a 429 with `"limit: 0, model: gemini-2.0-flash"`; the same key returned 403 `"Your API key was reported as leaked"` on other Gemini models. After multiple key rotations also failed (Google's revocation was project-wide, not just per-key), Gemini was removed entirely 2026-05-20 in favour of Groq as the sole remote provider.

**Root reason this is different from Finnhub / Twelve Data:**
LLM API keys have a **valuable abuse profile** ("burn someone's LLM token budget") that justifies the providers building automated scanners. Finnhub / Twelve Data have a low-value abuse profile ("burn through a free-tier quota of stock quotes") and don't bother — they tolerate publicly-baked keys. Any LLM provider's key has the same auto-revocation property.

**Cost of recovery if it happens again:**
- The leaked key is in commit history forever, even after deletion. Anyone running `git log -p` can read it.
- The user must rotate the key at the provider's console (Groq: https://console.groq.com/keys).
- The new key MUST be pasted into Settings, never into source.

**Code-level guards in place:**
1. `_SP_BAKED_KEYS` has an inline comment near the top warning that no LLM slot may exist.
2. `callLLM` classifies terminal-key responses (`leaked` / `auth`) and routes around them: dead-key fingerprint cached in localStorage for 24h, in-browser model auto-promoted on first detection, mid-stream UI swap so the user never sees a "wait a minute" dead-end.

**Future LLM providers**: when adding Anthropic / OpenRouter / etc., the same rule applies — no baked-key slot, BYO only. Document the rule in this section if a new provider lands.

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

## UI/UX discipline — apply on every visual change

Invoke `/ui-ux-pro-max` (skill base: `C:\Users\anush.nambi\.claude\skills\ui-ux-pro-max`) **before** building or restructuring any visual surface, and **after** any UI change before claiming "done". The skill enforces ten principles + an anti-pattern audit and produces a structured report. Summary of the contract below — full text lives in the skill.

### Ten principles (cite by number when flagging issues)

1. **One job per surface** — a tab / panel / card serves one user goal. Mixing "configure" with "consume" splits attention.
2. **One primary action per surface** — exactly one visually dominant CTA. Squint test: can you spot the "next step" in ≤1 second?
3. **Progressive disclosure** — show the 80% case; hide the 20% behind "Advanced" / chevron / sub-tab.
4. **Information scent** — labels telegraph what's behind them. No "Misc". A new user should predict each label's destination in one guess.
5. **Hierarchy via type, weight, spacing** — borders and shaded backgrounds are last-resort. Strip them; let typography do the work.
6. **No emoji as functional icon** — SVG, Unicode (★ ⚠ ✓ ↑ ↓ →), or text. Emoji-as-icon is the single biggest tell of LLM-generated UI.
7. **Tooltip discipline** — every metric / abbreviation / technical control has a `title=` with plain-language explanation (not the formula). StockPulse routes these through the central `TIP` dictionary.
8. **Empty states are first-class** — every list / table / panel has a designed empty state with one-sentence explanation + primary action. Test by clearing localStorage.
9. **Copy is design** — buttons are verbs ("Save bundle", not "Submit"). Errors say what broke AND what to do. Read every string aloud.
10. **Density appropriate to task** — dashboards earn density; settings / wizards / marketing surfaces do not. Don't apply landing-page whitespace to a power-user tool.

### Anti-patterns (blocking — do not ship)

1. Emoji-as-icon on buttons / nav / status
2. Two primary buttons fighting on one surface
3. Mystery icons (no `title=`, no adjacent text)
4. Compartment soup — 3+ nested bordered boxes
5. Jargon copy without a plain-language tooltip (P/E, HHI, Sharpe, etc.)
6. Animations >200ms that delay first interaction
7. Modal stacking modals
8. Save / Delete adjacent with similar visual weight
9. Lists / tables with `—` or "0 results" and no next-action
10. Mixed creation + consumption on one surface
11. Color as the only status signal (always pair with glyph or text)
12. Buttons that lie ("Submit" / "OK" / "Done" with no hint of outcome)

### Required output after any UI change

When working on a visual surface, end the response with the skill's report block (see §5 of the skill file). It documents user-job, primary action, per-principle ✓/⚠/✗ scoring, anti-patterns flagged, and P0/P1/P2 fix list. The report is the proof-of-rigour the user uses to verify the skill actually ran rather than producing a generic "looks good!" pass.

### StockPulse-specific application

- **Target user is a retail investor**, not an analyst. Lead tooltips with the layman explanation; the formula is secondary.
- **Cockpit, Watchlist, Sectors, Top Picks, What If** each have a distinct job (principle 1). Do not blur them — new functionality goes in the tab whose job it serves.
- **The TIP dictionary is the canonical home** for tooltip copy (principle 7). Add new entries there rather than inlining `title=` strings at call sites.
- **The thermal palette already carries status semantics**; pair it with a glyph / number / label whenever it's the only status signal (anti-pattern 11).
- **Empty states matter** for first-run users with no watchlist, no sim set, no saved bundles. Test by clearing localStorage in DevTools.

### Cross-page UI consistency — MANDATORY (2026-05-19)

When a filter / pill / chip / signal exists on **any** page, it MUST exist on **every** page that surfaces the same domain concept. The Top Picks page added a new "Ahead of rally" pill on 2026-05-19; the user immediately reported that the Sectors page didn't have it. This kind of one-page-only rollout is a doctrine failure — the user shouldn't have to discover that the same filter exists with a different name (or not at all) per tab.

**The four filter surfaces that share the same timing taxonomy:**

| Surface | Filter location | Identifier |
|---|---|---|
| Watchlist sidebar | `#timing-filter` pills | `updateTimingFilterPills()` |
| Sectors discovery | `#sectors-discovery-filters` "Buy timing" row | `renderSectorsFilterPills()` |
| Top Picks | `#picks-timing-pills` | `_renderPicksTimingPills()` |
| Ticker dashboard | inline `renderTimingChip(timing)` | (display only, no filter) |

**Rule:** every value emitted by `computeBuyTiming().action` (currently `BUY_NOW`, `EARLY_RALLY`, `BUY_ON_DIP`, `DCA`, `WAIT`, `CONFLICT`, `SELL`, `AVOID`) MUST appear as a filter option in **all four** surfaces above (those with filters). The same applies to:

- Verdict pills (`STRONG BUY` / `BUY` / `HOLD` / `SELL` / `STRONG SELL`) — Sectors tile, Top Picks row, Ticker dashboard. **Exception (2026-05-19):** NOT shown on the Watchlist sidebar row because verdict + timing on the same compact row produced contradictory readings (e.g. `HOLD` + `Buy` — verdict says "don't act" while timing says "buy now"). On Watchlist rows the timing chip supersedes the verdict pill; verdict is still carried by (a) the left-edge heat-color bar (cold = SELL tier, hot = BUY tier), (b) the row-level hover tooltip (now includes verdict + score + signal trace), and (c) the full ticker dashboard.
- Type pills (`Div` / `Hi-Yld` / `ETF` / `Stocks`) — Watchlist, Sectors (the "Dividend" filter row)
- 13F pills (`≥1 / ≥2 / ≥3`) — Watchlist, Sectors, Top Picks
- Heat tier colours / icons — every surface that shows a ticker

**Verdict vs Timing — which goes where:**

| Surface | Show verdict pill? | Show timing chip? | Reason |
|---|---|---|---|
| Watchlist sidebar row | ❌ no | ✅ yes | Space-constrained; timing is the actionable refinement of verdict. Heat bar carries the verdict tier. |
| Top Picks row | ✅ yes | ✅ yes | Has a verdict-filter UI at the top — pill needs to be visible for the filter to be verifiable. |
| Sectors tile | ✅ yes | ✅ yes | Same reason as Top Picks — verdict-filter UI on this page. |
| Ticker dashboard | ✅ yes (`#verdict-card`) | ✅ yes (timing-card) | Full info surface — both clearly labelled with their own card. |
| Cockpit perf card | inline text only | ❌ no | At-a-glance compact card; verdict appears as inline text next to price. |

**Test before shipping:** when adding any new pill / chip / signal, search the codebase for the other three surfaces and add the same option there too. If you can't — leave a `TODO(consistency)` comment with the date so it's not forgotten.

### Filter density discipline (2026-05-19)

Sidebar filters were simplified from 5 always-visible rows to 1 visible row + "More filters ▾" toggle after user feedback. Rules going forward:

- **Drop explicit "All" pills.** Active pill click deselects it. That's the modern toggle pattern.
- **Hide zero-count pills.** If a filter dimension has zero matches, don't render the pill — it's noise.
- **Primary filters always visible.** Verdict (Buy/Hold/Sell) and list (Fav/SimSet) are primary. Type / Timing / 13F are secondary — collapsed behind "More filters ▾" by default.
- **Persist the toggle state.** Power users who open "More filters" once shouldn't have to re-open every session — store in localStorage.

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
