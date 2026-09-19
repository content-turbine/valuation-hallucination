# Valuation Hallucination — Coming Soon

Pre-launch landing page for **Valuation Hallucination**, a satirical card game about AI startups, hidden side hustles, dirty tricks, market chaos, and the race to a $1 billion valuation.

## Deployment

This is a static site with two Vercel Functions. No build command is required and the project root is the output directory.

## Experiences

- `/` — coming-soon page with a gamified waitlist, founder archetype, valuation, position, and referral link.
- `/market` — mobile-first market-card simulator with a center-of-table view.
- `/api/market` — daily or random pre-launch market card feed.
- `/api/waitlist` — private waitlist capture.

## Waitlist storage

Connect a Postgres database to the Vercel project and expose either `DATABASE_URL` or `POSTGRES_URL`. The API creates and uses only the `valuation_hallucination` schema. It does not read from or write to any other schema.

The included `db/001_waitlist.sql` migration documents the table structure. The API also initializes that same schema safely on first use.

Email consent, signup source, referral attribution, and signup time are stored with every record. Emails never appear in the browser response or public assets.

## Live market scope

The current `/market` route is an honest pre-launch simulator using the ten balanced market conditions from the game design. It is ready to be linked from a physical-card QR code. A later service can replace `/api/market` with selected real-world-news classification without changing the player-facing URL.
