CREATE TABLE IF NOT EXISTS valuation_hallucination.social_campaign_posts (
  id BIGSERIAL PRIMARY KEY,
  campaign_day DATE NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('instagram','tiktok','x','facebook')),
  theme TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  asset_brief TEXT NOT NULL DEFAULT '',
  asset_url TEXT NOT NULL DEFAULT '',
  media_url TEXT NOT NULL DEFAULT '',
  destination_url TEXT NOT NULL DEFAULT 'https://valuationhallucination.com/',
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','changes_requested','approved','scheduled','published','failed')),
  producer TEXT NOT NULL DEFAULT 'manual',
  source_url TEXT NOT NULL DEFAULT '',
  rationale TEXT NOT NULL DEFAULT '',
  submission_key TEXT UNIQUE,
  external_post_id TEXT,
  error_message TEXT,
  approved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE valuation_hallucination.social_campaign_posts
  ADD COLUMN IF NOT EXISTS asset_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS rationale TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS submission_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS social_campaign_submission_key_idx
  ON valuation_hallucination.social_campaign_posts (submission_key);
CREATE INDEX IF NOT EXISTS social_campaign_posts_day_idx
  ON valuation_hallucination.social_campaign_posts (campaign_day DESC, created_at DESC);
