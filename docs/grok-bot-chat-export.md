# Grok Bot chat export — building Predictle (News-to-Trade Desk)

Cleaned export of the conversation between **Priscilla Ye** and her Grok Bot agent **UBC hackathon bot** during the [UBC 2026 Hackathon](https://ubc-hackathon-2026.devpost.com/). Tool calls, system prompts, and secrets are omitted. Timestamps are America/Chicago (CST/CDT).

This export shows how Grok Bot was used to design, research, build, review, and ship the project: parallel agents for UI pages, real-data-only rules, merge workflow, pitch and README writing.

---

## Setup and direction (Nov 17–18, 2026)

**Priscilla:** Built Predictle / News-to-Trade Desk for UBC 2026 — Chrome extension market cards under X posts, Next.js desk, Gemini prediction markets, Solana USDC payments, agentic spend guardrails. Asked Grok Bot to help architecture, coding agents, and demo framing.

**UBC hackathon bot:** Mapped the product to the Agentic Payments & AI track and Best use of Solana; proposed a pitch one-liner: *"News breaks on X, and the market comes to you. Bet in one reply or one sentence, with an AI agent that can't overspend and explains every decision."* Established rules: follow `AGENTS.md` / agent-coding-rules, real data only, never fake numbers, merge only on Priscilla's yes, no secrets in git.

---

## Dashboard redesign and latency (Nov 19 morning)

**Priscilla:** Redesigned the UI from her design files. Approved merging PRs for Home and Markets. Asked why Markets took so long ("Loading live markets…") and why "Gemini is busy" appeared.

**UBC hackathon bot:** Diagnosed that the bottleneck was our own serial request queue overflowing (502s), not Gemini itself. Shipped concurrency caps, TTL caches, in-flight dedupe, and 429 retry (PRs #7–#10). Fixed duplicate React keys (PR #9). Home and Markets then load live Gemini markets with sparklines.

**Priscilla:** "Merge it." (multiple times for perf PRs)

**UBC hackathon bot:** Merged only after her yes; reported main test counts after each merge.

---

## Parallel page builds — Beginner, Watchlist, Pro (Nov 19 afternoon)

**Priscilla:** "Merge it. Can you spin up a separate agent to work on the market detail page? (beginner view) The information populated should be real information and data, reuse any code necessary, delete all irrelevant code / junk code"

Then: spin up another agent for the Watchlist (star from Markets → Watchlist), and another for the Pro terminal, all with real data.

**UBC hackathon bot:** Launched three parallel builds on separate branches:

| PR | Feature | Outcome |
|---|---|---|
| [#11](https://github.com/ScriptKitKat/UBC-Hacakthon/pull/11) | Watchlist + star from Home/Markets | Merged |
| [#12](https://github.com/ScriptKitKat/UBC-Hacakthon/pull/12) | Beginner market research page | Merged |
| [#13](https://github.com/ScriptKitKat/UBC-Hacakthon/pull/13) | Pro market terminal | Merged |

Real-data policy enforced: hide trader count, mentions vs last week, open interest, and any panel without a Gemini source. Paper desk: market buys only (no limit/sell until implemented). Screenshots and tests before each merge ask.

**Priscilla:** Follow-ups on beginner page — remove "Why it moved" without X posts; remove push/pull if irrelevant; clarify trader/mentions; ask how to get price history.

**UBC hackathon bot:** Opened [PR #14](https://github.com/ScriptKitKat/UBC-Hacakthon/pull/14): hide empty sections; document candle/trade/snapshot fallbacks for price history; X posts from extension scrape (optional `X_BEARER_TOKEN` for search). Later merged.

**Priscilla:** "merge 13 for nwo"

**UBC hackathon bot:** Merged Pro terminal; reported main at 1,312 tests green.

---

## Portfolio, Briefs, Watchlist Agents (Nov 19 evening)

**Priscilla:** Pointed at her Claude design artifact and asked to spin up agents for the rest of the UI with real APIs. Clarified: "portfolio, briefs, agent page I think" and "agent page is part of the watch list page"

**UBC hackathon bot:** Captured artboards, then started three builds:

| PR | Feature |
|---|---|
| [#15](https://github.com/ScriptKitKat/UBC-Hacakthon/pull/15) | Portfolio (`/positions`) — P/L, spend vs cap, calibration, CSV, Solana receipts |
| [#16](https://github.com/ScriptKitKat/UBC-Hacakthon/pull/16) | Watchlist Agents — personalities, triggers, budgets, watch / suggest / autonomous within global $2 / $10 / $20 policy |
| [#17](https://github.com/ScriptKitKat/UBC-Hacakthon/pull/17) | Briefs library — x402 $0.05 deep dives, stale-odds filter, Solana receipts |

**Priscilla:** "create PRs for all of these" → "can you push whatever is left to each of the PRs, don't test for now"

**UBC hackathon bot:** Opened all three PRs (Portfolio had already finished checks). Noted: no `XAI_API_KEY` on the box yet → agent messages use labeled templates until a key is set; autonomous bets and paid briefs implemented but not live-run in tests. Later these landed on main (along with further agent/UI PRs through #35).

---

## Research: what Beginner vs Pro pages should have (Nov 20 early morning)

**Priscilla:** "what should the beginner market research page have and why? what should the pro market research page have and why? … do research online … outline and list each features"

**UBC hackathon bot:** Researched Kalshi/Polymarket/Robinhood UX, FINRA investor surveys, CEPR longshot bias, Tetlock outside-view forecasting, Kalshi Pro / trader interviews. Delivered 12 features per view with sources, plus:

- **Correction:** Gemini *does* publish fees ([fee schedule](https://www.gemini.com/fees/predictions)); the Pro ticket showing "—" was wrong — fee is computable.
- Beginner focus: plain YES-if rules, price-as-chance + longshot caveat, payout-with-fee box, trust/liquidity meter, no fake trader counts, no gamification badges.
- Pro focus: book ladder, tape, limit orders, slippage guard, shortcuts, news lined up with moves, risk/Kelly.

---

## Pitch script, README, elevator pitch, Grok Bot evidence (Nov 20 morning — submission day)

**Priscilla:** "help me create a script for the hackathon pitch video"

**UBC hackathon bot:** Wrote a ~2:30 timed script (Devpost asks for 2–3 minutes): X post → card → Beginner/Pro research → $2 guarded buy → Solana Explorer receipt → $0.05 x402 brief → agents/portfolio → close. Pre-record checklist included.

**Priscilla:** "create a read me file based on the requirements from the hackathon … and push it to the github main branch"

**UBC hackathon bot:** Wrote and pushed README with problem, features, architecture diagram, buy flow, setup, safety, sponsor tools. ([README](https://github.com/ScriptKitKat/UBC-Hacakthon/blob/main/README.md))

**Priscilla:** Elevator pitch, 20 words max.

**UBC hackathon bot:** *"See news on X, bet on it instantly: AI-matched Gemini prediction markets, paid in USDC on Solana with spending guardrails."* (19 words)

**Priscilla:** Include a Grok Bot chat export in the project and list it on the README; include a short README (3–4 sentences) explaining Grok Bot's role.

**UBC hackathon bot:** Added [Grok Bot's role](../README.md#grok-bots-role) to the README and this export at `docs/grok-bot-chat-export.md`.

---

## How Grok Bot was used (summary for judges)

1. **Orchestration** — Parallel coding agents for Home, Markets, Beginner detail, Pro terminal, Watchlist, Portfolio, Briefs, and Agents; PRs opened with tests/screenshots; merges only on founder approval.
2. **Engineering judgment** — Real-data-only UI (hide empty Gemini fields), latency diagnosis (our queue vs Gemini), candle-order bugs, fee-schedule discovery.
3. **Product research** — Beginner vs Pro feature lists grounded in external studies, not just the existing screens.
4. **Submission artifacts** — Pitch video script, elevator pitch, architecture README, and this chat export for the Grok Bot bounty.

Product integrations of Grok (xAI API) inside Predictle: post→market matching in the Chrome extension, brief polish, and watchlist-agent decisions/messages (with Claude as optional fallback).
