# TonAlert — Telegram Watcher for Toncoin & TON Jettons

## Summary
TonAlert is a Telegram bot that lets each user privately watch Toncoin and TON jettons (e.g., USDT, GRAM) and receive timely, non-spammy alerts when prices cross user-set thresholds, or when a token moves more than a user-configurable percent within a rolling time window (default: 1 hour). Users manage a private watchlist with inline buttons, request on-demand prices, and optionally receive a morning summary. Quiet hours, alert cooldowns, and retry-on-price-source-failure behaviour keep notifications reliable and unobtrusive. An owner/admin view shows active users and firing-alert statistics.

## Audience
- Retail Toncoin / TON jetton holders who want immediate, private alerts for price moves.
- Bot owner/operator who needs basic analytics on usage and alert frequency.

## Core entities
- User (Telegram chat id, preferences, timezone, quiet hours, morning-summary time)
- Token (identifier: token type + canonical id; e.g., "TON" as native Toncoin, or jetton by contract address and symbol)
- Watch entry (user_id, token_id, alert rules)
- Alert rule types:
  - Absolute threshold: price <= or >= X in chosen fiat (default USD)
  - Percent-move rule: move >= Y% within window (default 5% in 1 hour)
  - One-shot vs recurring (one-shot fires once then needs reset; recurring stays active)
- Alert event (timestamp, token, rule, price_before, price_after, percent_change, delivered, delivery_timestamp)
- Owner analytics (user counts, per-token alert counts, recent fired alerts)

## Integrations & notification targets
- Telegram Bot API for all user interaction and notifications (private chats only). Use inline keyboard buttons and commands.
- Price data sources (primary: CoinGecko public API for Toncoin; token contract price lookup via CoinGecko + fallback: TonSwap, DexScreener, or a TON-specific price index API). Local cache of recent prices and a failover sequence if primary fails.
- Persistence: PostgreSQL for user data, watchlists, rules and alert history; Redis for short-lived caches, rate-limiting, and background job queue.
- Background worker (e.g., Celery / RQ or a lightweight scheduler) to poll price feeds and evaluate rules.
- Optional: Sentry (errors) and Prometheus / Grafana (metrics) for ops visibility.
- Owner notifications: owner receives daily or on-demand admin report via a secure admin Telegram chat (owner Telegram ID configured at deploy). No public dashboard required for MVP.

## Interaction flows
- Onboarding
  - User starts bot (/start). Bot greets, asks for preferred fiat (default USD), timezone (optional auto-detect), and whether to enable morning summary.
- Watchlist management (inline buttons / simple commands)
  - /add: user types symbol or contract (fuzzy match). Bot shows 3-best matches with inline "Add" buttons.
  - After selecting a token: bot asks what alert to create with quick options: "Price below", "Price above", "Move ≥ % in 1h", "Skip". Each option is a button.
  - For absolute thresholds: bot accepts natural language (examples shown) and confirms parsed value (e.g., "Alert when TON ≤ $2.50").
  - /list shows watchlist with each item having inline buttons: "Price now", "Edit rule", "Remove".
  - /price <symbol> or inline "Price now" returns current price, 1h change, 24h change and last reliable price timestamp.
- Alerting behavior
  - Rule evaluation runs at regular cadence (default every 60s). For percent-move rules use rolling-window percent change computed from cached prices.
  - When a rule fires, send one clear alert message that includes: token name, current price, what triggered (e.g., "dropped below $2.50" or "↑ 6.2% in 1h"), precise delta (absolute and percent), baseline values (price X -> price Y), timestamp, and a small action row: [Price now] [Snooze 1h] [Disable rule].
  - Suppression: after firing, the same rule is suppressed for a cooldown period (default 1 hour) unless the rule is explicitly recurring and the price moves back past a reset margin (default 1% beyond threshold) — i.e., avoid repeated alerts while price hovers.
  - Quiet hours: do not deliver push messages in the user’s quiet hours; instead accumulate one summary to deliver when quiet hours end (unless user allows immediate delivery). Quiet hours default 23:00–07:00 in user's timezone.
- Morning summary
  - Optional scheduled message at user's configured time containing each watched token: current price, 24h change, and list of rules that triggered overnight (if any). Single concise message per user.
- Error handling & reliability
  - If price source fails or returns stale/invalid data, the worker retries with exponential backoff (3 attempts) and uses fallback sources. If all fail, do not fire alerts; instead log and (optionally) send a single admin notification about degraded data.
  - Validation: user inputs are parsed with tolerant parsing (allow commas, currency symbols, misplaced decimals). If ambiguous, bot asks a single clarifying question.

## Persistence
- PostgreSQL schema (minimum): users, tokens, watches (rules), alert_history, admin_events.
- Redis: price cache (per-minute granularity), job queue, rate-limits, cooldown markers.
- Keep alert history for at least 90 days (configurable). Store last-fired timestamp per rule to enforce cooldown and reset logic.

## Payments
- None in MVP. No in-bot purchases. Bot remains free to use.

## Non-goals (MVP)
- No group chat monitoring; bot operates in private chats only.
- No fiat on/offramps or trade execution.
- No advanced portfolio valuation across exchanges (beyond per-token price × user-supplied holdings — holdings tracking is optional for later).
- No public web dashboard in MVP (owner view is via Telegram admin chat/exportable CSV).

## Message templates (examples)
- Threshold alert (price drop): "TON dropped below $2.50 — now $2.46 (−1.6% since last check). Trigger: price ≤ $2.50. [Price now] [Snooze 1h] [Disable rule]"
- Percent-move alert: "USDT jumped +5.4% in the last 60 minutes: $0.98 → $1.03 (+5.4%). Trigger: ≥5% in 1h. [Price now] [Snooze 1h] [Disable rule]"
- Price-source failure (admin only): "Price feed error: CoinGecko failing for TON at 2026-06-15T08:12Z — using fallback."

## Owner/admin view
- Admin commands available only to configured owner Telegram ID:
  - /stats — total users, active watchcounts, top-10 tokens by watches, alerts fired in last 24h.
  - /export alerts since=<date> — CSV of alert events.
  - Daily digest to owner with spikes in alerting frequency or data-source outages.

## Operational notes
- Polling cadence: 60s evaluation cycle for all active tokens across users, with deduplication: evaluate distinct tokens once and reuse price for all watchers.
- Rate-limits: respect upstream API rate limits; aggregate requests (batch queries where API supports) and apply local caching.
- Security & privacy: per-user settings are private. No token watchlist shared. Admin access limited to single owner Telegram ID. Store minimal PII (Telegram ID, timezone).
- Deploy: containerized (Docker), with env-configured API keys and owner Telegram ID. Build with staged dev/test/prod config.

## Assumptions & defaults
- Watch identification: tokens accepted by symbol or jetton contract address; CoinGecko ID mapping is used where possible — fallback fuzzy search against TonSwap/DexScreener. Rationale: CoinGecko covers Toncoin and many jettons and is free for MVP.
- Fiat display: default USD. Rationale: common default; user may change per account.
- Polling cadence: 60 seconds. Rationale: balances timeliness and API rate limits.
- Percent-window: default 1 hour for the "move" rule, with default threshold 5%. Rationale: matches owner request and is commonly useful.
- Quiet hours default: 23:00–07:00 in user's timezone; user may configure their own. Rationale: prevents night spamming as requested.
- Alert cooldown: 1 hour per rule after firing; reset requires the price to move beyond 1% away from the threshold or user action. Rationale: prevents repeated alerts when price hovers.
- Retry policy for price source: 3 tries with exponential backoff, then use fallback source; if all fail, do not produce alerts. Rationale: avoid garbage alerts.
- Owner admin access: single owner Telegram ID provided at deploy; owner receives daily summary and can run on-demand /stats. Rationale: owner asked for a view; Telegram admin chat is simplest secure channel for MVP.


If you want any different defaults (price source, cooldown, polling interval, fiat), tell me which single setting to change now; otherwise I’ll proceed using the brief above as the build spec.