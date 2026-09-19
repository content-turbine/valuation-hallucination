# Valuation Hallucination — Coming Soon

Pre-launch landing page for **Valuation Hallucination**, a satirical card game about AI startups, hidden side hustles, dirty tricks, market chaos, and the race to a $1 billion valuation.

## Deployment

This is a static launch site with small, isolated Vercel Functions. No build command is required and the project root is the output directory.

## Experiences

- `/` — coming-soon page with a gamified waitlist, founder archetype, valuation, position, and referral link.
- `/market` — mobile-first live market card with a center-of-table view.
- `/api/market` — current public real-world Market Event.
- `/api/market/generate` — protected manual generation of three candidates.
- `/api/slack/events` — signed Slack reply handler for `pick 1`, `pick 2`, or `pick 3`.
- `/api/waitlist` — private waitlist capture.

## Waitlist storage

Connect a Postgres database to the Vercel project and expose either `DATABASE_URL` or `POSTGRES_URL`. The API creates and uses only the `valuation_hallucination` schema. It does not read from or write to any other schema.

The included `db/001_waitlist.sql` migration documents the table structure. The API also initializes that same schema safely on first use.

Email consent, signup source, referral attribution, and signup time are stored with every record. Emails never appear in the browser response or public assets.

## Live market feature

The market engine is a contained feature of the site, not the site architecture. It uses the same Postgres database connection but stores data only in `valuation_hallucination.market_event_runs`.

The service checks the GDELT news feed for English-language technology, startup, venture-capital, and market headlines. Unsafe topics are excluded. Keyword scoring maps suitable headlines to the ten balanced Market Event effects from the game design. Up to three candidates are stored for six hours; candidate 1 is selected automatically unless a human overrides it in Slack.

Required production variables:

- `DATABASE_URL` or `POSTGRES_URL`
- `MARKET_ADMIN_TOKEN` for `POST /api/market/generate`
- `SLACK_BOT_TOKEN` with `chat:write`
- `SLACK_SIGNING_SECRET`
- `VH_SLACK_CHANNEL_ID`

Configure the Slack app's Event Subscription request URL as `https://www.valuationhallucination.com/api/slack/events`, subscribe the bot to `message.channels` (and `message.groups` for a private channel), then invite the bot to the selected channel. Each generation posts three candidates. Reply in that thread with `pick 1`, `pick 2`, or `pick 3`.
