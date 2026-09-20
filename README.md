# Valuation Hallucination — Coming Soon

Pre-launch landing page for **Valuation Hallucination**, a satirical card game about AI startups, hidden side hustles, dirty tricks, market chaos, and the race to a $1 billion valuation.

## Deployment

This is a static launch site with small, isolated Vercel Functions. No build command is required and the project root is the output directory.

## Experiences

- `/` — coming-soon page with the Founders’ Round, Founder ID, archetype, valuation, referral milestones, leaderboard rank, community-vote allowance, and Founder Edition eligibility.
- `/market` — mobile-first live market card with a center-of-table view.
- `/choose` — staged three-card reveal and Founder ID community vote.
- `/terms` — Founders’ Round promotional terms.
- `/privacy` — pre-launch privacy notice.
- `/api/market` — current public real-world Market Event.
- `/api/market/generate` — protected manual generation of three candidates.
- `/api/slack/events` — signed Slack reply handler for `pick 1`, `pick 2`, or `pick 3`.
- `/api/waitlist` — private waitlist capture.
- `/growth` — private, token-gated Reddit acquisition dashboard and tracked-link builder.
- `/api/events` — first-party conversion events (no third-party analytics SDK).
- `/api/admin/growth` — protected aggregate growth reporting.
- `/api/admin/leads` — protected lead export.
- `/api/cron/reddit-digest` — daily Slack draft recommendation for human review.

## Waitlist storage

Connect a Postgres database to the Vercel project and expose either `DATABASE_URL` or `POSTGRES_URL`. The API creates and uses only the `valuation_hallucination` schema. It does not read from or write to any other schema.

The included `db/001_waitlist.sql` migration documents the table structure. The API also initializes that same schema safely on first use.

Email consent, signup source, referral attribution, and signup time are stored with every record. Emails never appear in the browser response or public assets.

## Reddit growth loop

The public page preserves first-touch attribution in the visitor's browser and records a small event taxonomy: page view, waitlist start, waitlist signup, referral-link copy, qualified referral, and referral milestone. Supported campaign parameters are:

`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `subreddit`, `reddit_post_id`, and `ref`.

Open `/growth`, enter `GROWTH_ADMIN_TOKEN`, and use the dashboard to:

- compare visits, form starts, founders, conversion rate, and qualified referrals by Reddit post;
- create consistent tracked Reddit links;
- see referral leaders without exposing email addresses in the dashboard;
- download the complete consented lead list as a protected CSV;
- work through the community-specific Reddit content queue; and
- receive a next-post recommendation based on measured conversions.

The daily Vercel cron sends a proposed post brief to Slack at 14:00 UTC. It never publishes to Reddit. A human must review the subreddit rules, approve the wording, and post through an authenticated Reddit session.

### Founders’ Round milestones

- Join: Founder ID, archetype, starting valuation, and one community-card vote.
- 1 qualified referral: +$50M virtual valuation and leaderboard movement.
- 3 qualified referrals: a second community-card vote.
- 5 qualified referrals: an opt-in invitation for a display name on the digital Founders’ Cap Table.
- Back during the first 48 hours of the Kickstarter campaign: eligibility for the disclosed Founder Edition bonus, subject to the Founders’ Round Terms and successful pledge collection.

### Community card reveal

`/choose` reads the public reveal state from `/api/card-vote`. The three default reveals are September 22, 24 and 26, 2026 at noon Eastern, with voting closing October 3 at 11:59 p.m. Eastern. Override the schedule and card copy in Vercel with `CARD_VOTE_1_*`, `CARD_VOTE_2_*`, `CARD_VOTE_3_*`, and `CARD_VOTE_CLOSES_AT` environment variables. Votes are stored in `valuation_hallucination.card_votes`; one ballot is allowed per Founder ID, and founders with three or more qualified referrals receive a vote weight of two.

Terms acceptance is versioned as `founders-round-2026-09-19`. The production contact alias referenced by the legal pages is `hello@valuationhallucination.com`; keep that mailbox or alias active before collecting signups under these terms.

## Live market feature

The market engine is a contained feature of the site, not the site architecture. It uses the same Postgres database connection but stores data only in `valuation_hallucination.market_event_runs`.

The service checks the GDELT news feed for English-language technology, startup, venture-capital, and market headlines. Unsafe topics are excluded. Keyword scoring maps suitable headlines to the ten balanced Market Event effects from the game design. Up to three candidates are stored for six hours; candidate 1 is selected automatically unless a human overrides it in Slack.

Required production variables:

- `DATABASE_URL` or `POSTGRES_URL`
- `MARKET_ADMIN_TOKEN` for `POST /api/market/generate`
- `SLACK_BOT_TOKEN` with `chat:write`
- `SLACK_SIGNING_SECRET`
- `VH_SLACK_CHANNEL_ID`
- `GROWTH_ADMIN_TOKEN` (long random token for `/growth` reporting)
- `CRON_SECRET` (used by Vercel Cron to authenticate the daily digest)
- `PUBLIC_SITE_URL=https://www.valuationhallucination.com`

Optional growth alert variable:

- `GROWTH_SLACK_WEBHOOK_URL` — if omitted, growth alerts reuse `SLACK_BOT_TOKEN` and `VH_SLACK_CHANNEL_ID`.

Configure the Slack app's Event Subscription request URL as `https://www.valuationhallucination.com/api/slack/events`, subscribe the bot to `message.channels` (and `message.groups` for a private channel), then invite the bot to the selected channel. Each generation posts three candidates. Reply in that thread with `pick 1`, `pick 2`, or `pick 3`.
