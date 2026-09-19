CREATE SCHEMA IF NOT EXISTS valuation_hallucination;

CREATE TABLE IF NOT EXISTS valuation_hallucination.growth_events (
  id BIGSERIAL PRIMARY KEY,
  event_name TEXT NOT NULL,
  visitor_id TEXT,
  session_id TEXT,
  founder_id BIGINT,
  source TEXT NOT NULL DEFAULT 'direct',
  medium TEXT,
  campaign TEXT,
  content TEXT,
  subreddit TEXT,
  reddit_post_id TEXT,
  referral_code TEXT,
  landing_path TEXT,
  referrer_url TEXT,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS growth_events_created_at_idx
  ON valuation_hallucination.growth_events (created_at DESC);
CREATE INDEX IF NOT EXISTS growth_events_campaign_idx
  ON valuation_hallucination.growth_events (source, campaign, content);
CREATE INDEX IF NOT EXISTS growth_events_visitor_idx
  ON valuation_hallucination.growth_events (visitor_id, created_at DESC);

ALTER TABLE valuation_hallucination.waitlist
  ADD COLUMN IF NOT EXISTS visitor_id TEXT,
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_content TEXT,
  ADD COLUMN IF NOT EXISTS subreddit TEXT,
  ADD COLUMN IF NOT EXISTS reddit_post_id TEXT,
  ADD COLUMN IF NOT EXISTS landing_path TEXT,
  ADD COLUMN IF NOT EXISTS referrer_url TEXT;
