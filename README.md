# StockPulse

A single-file dark-themed stock analysis dashboard built in vanilla JavaScript — no server, no build step, no framework. Open `index.html` in a browser and it works.

**Live demo:** https://nambianush-wq.github.io/Stock-Pulse/

---

## What it does

StockPulse turns the noise of "should I buy / hold / sell?" into a single composite verdict for any US-listed stock or ETF, with the math behind every decision exposed for inspection.

### The four tabs

| Tab | What it answers |
|---|---|
| **Watchlist** | "What's happening with the stocks I'm tracking?" — heat-ranked list, click any ticker for a full analysis panel with verdict, charts, exec summary, news, forecast, and 100+ datapoints. |
| **Sectors** | "What are the top stocks in each sector for my goal?" — 5 investment goals (Growth, Capital Preservation, Income, Value, Momentum), each with a tile grid showing 1Y/3Y/5Y history + 12/24/36M forecast for every catalog name. |
| **Top Picks** | "What are the 100 best Buy/Strong-Buy candidates right now, grouped by sector?" — sector-mood color-coded jump bar, ranked picks per sector, history + forecast cards on every row. |
| **What If** | "If I had $X to invest for goal Y, what would the optimal mix look like?" — portfolio builder that allocates across a curated mix of stocks + ETFs, with risk metrics (beta, Sharpe, max drawdown, HHI), upcoming catalyst calendar, and full method/parameter panel. |

### Power features

- **Save bundles** — capture any What-If portfolio with a name, track daily / cumulative P&L over time, forecast-vs-actual chart, highlights row (top + worst performer, vs-forecast pace), modify holdings later.
- **Favorites + Sim Set** — star any ticker (auto-adds to watchlist) or add to Sim Set (curated input for "Build from Sim Set" in What-If).
- **Cross-check** — optional second-source price from Twelve Data, color-coded delta vs Finnhub.
- **Verify links** — outbound chips to Yahoo Finance, TradingView, StockCharts, Google Finance, and Yahoo analyst-consensus pages for every ticker.
- **Layman tooltips** — every indicator (RSI, MA stack, Beta, Sharpe, HHI, max drawdown, period return, P/E, dividend yield, etc.) has a plain-English "What this means" tooltip on hover.

---

## Quickstart

### 1. Open the app

Either:
- **Public URL** (recommended): https://nambianush-wq.github.io/Stock-Pulse/
- **Local clone**: download `index.html` and double-click it to open in your browser.

### 2. Add a Finnhub API key for live data (optional but recommended)

Without a key, StockPulse runs in DEMO mode with synthetic prices anchored to realistic recent values. Free Finnhub tier (60 calls/min) unlocks live quotes, profile, financials, and news headlines for any US ticker.

1. Sign up free at [finnhub.io/register](https://finnhub.io/register)
2. Open ⚙ Settings in StockPulse, paste your key, click Save
3. The mode pill in the top bar flips from amber **DEMO** to green **LIVE**

### 3. Add a Twelve Data key for price cross-check (optional)

Same pattern as Finnhub. Twelve Data's free tier (800 calls/day) provides a second-source quote that's compared to Finnhub's. When prices diverge >2%, a red warning chip appears so you know something is off (stale data, API issue, etc.).

Get a key at [twelvedata.com/register](https://twelvedata.com/register).

### 4. Use the app

- **Add stocks**: top-right `+ Add Stock` button. Search by ticker (AAPL) or company name (Apple). Catalog has ~120 popular US stocks and ETFs.
- **Star ★**: marks a favorite and auto-adds it to the Watchlist.
- **+ Sim Set**: adds the ticker to your simulation set, which feeds into the "Build from Sim Set" button on the What If tab.
- **Filter the watchlist**: click the Favorites / Sim Set counters in the sidebar, or use the Buy / Hold / Sell verdict pills, or the Div / Hi-Yld / ETF / Stocks type pills.
- **Build a portfolio**: What If tab → enter amount + pick a goal → click Build. Save it as a named bundle to track over time.

---

## Architecture

- **One file**: `index.html` (~770 KB). HTML + CSS + JS all inline. No build step, no bundler, no dependencies beyond what the browser loads from a CDN.
- **Charts**: [TradingView lightweight-charts](https://github.com/tradingview/lightweight-charts) loaded from unpkg.
- **Storage**: localStorage for watchlist, settings, favorites, sim set, saved bundles, API keys (with backup slot for resilience).
- **Live data**: [Finnhub](https://finnhub.io/) (`/quote`, `/candle`, `/profile2`, `/metric`, `/company-news`) + optional [Twelve Data](https://twelvedata.com/) for cross-check.
- **No server**: every computation (indicators, verdict score, forecast model, risk metrics, sector rankings, portfolio allocation) runs in the browser.

### Demo mode

When no Finnhub key is set, StockPulse uses anchored synthetic data:
- ~100 well-known tickers have realistic recent-price anchors (AAPL ~$300, MSFT ~$420, ACN ~$168, etc.)
- For each ticker, a deterministic random walk generates 5 years of weekly bars
- Every analysis, forecast, risk metric, and chart works identically — the only difference is the data source

This makes the app fully usable without any API setup. Good for exploring features before committing to a Finnhub key.

### Hybrid mode

When Finnhub's `/candle` endpoint fails (e.g. free-tier paywall) but `/quote` still works, StockPulse:
1. Pulls the live current price from `/quote`
2. Scales the synthetic bar history so the last close matches the live price
3. Surfaces an amber "Hybrid data — live current price, synthetic history" chip in the ticker header

You get an accurate price for today plus an indicative trend, with transparent labeling.

---

## Privacy + safety

- **No tracking, no analytics, no third-party scripts** beyond the lightweight-charts CDN.
- **API keys live in your browser's localStorage** — never sent anywhere except directly to Finnhub/Twelve Data over HTTPS.
- **Export your keys to a file** via ⚙ Settings → Export keys so you can restore them if browser data is cleared.
- **Not investment advice.** Forecasts and verdicts are heuristic. The app is a directional analysis tool, not a trading recommendation.

---

## License

MIT. Free for personal or commercial use.

---

*Built with [Claude Code](https://claude.com/claude-code).*
