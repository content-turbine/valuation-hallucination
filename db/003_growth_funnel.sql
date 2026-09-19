CREATE SCHEMA IF NOT EXISTS valuation_hallucination;

ALTER TABLE valuation_hallucination.waitlist
  ADD COLUMN IF NOT EXISTS landing_path TEXT,
  ADD COLUMN IF NOT EXISTS referrer TEXT,
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_content TEXT,
  ADD COLUMN IF NOT EXISTS subreddit TEXT,
  ADD COLUMN IF NOT EXISTS session_id TEXT;

CREATE TABLE IF NOT EXISTS valuation_hallucination.funnel_events (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT,
  event_name TEXT NOT NULL,
  path TEXT,
  referrer TEXT,
  source TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  subreddit TEXT,
  referral_code TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS funnel_events_created_at_idx
  ON valuation_hallucination.funnel_events (created_at DESC);

CREATE INDEX IF NOT EXISTS funnel_events_event_name_idx
  ON valuation_hallucination.funnel_events (event_name);

CREATE INDEX IF NOT EXISTS funnel_events_subreddit_idx
  ON valuation_hallucination.funnel_events (subreddit);

CREATE INDEX IF NOT EXISTS waitlist_subreddit_idx
  ON valuation_hallucination.waitlist (subreddit);

CREATE INDEX IF NOT EXISTS waitlist_utm_campaign_idx
  ON valuation_hallucination.waitlist (utm_campaign);
