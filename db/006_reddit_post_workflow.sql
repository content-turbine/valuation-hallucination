CREATE SCHEMA IF NOT EXISTS valuation_hallucination;

CREATE TABLE IF NOT EXISTS valuation_hallucination.reddit_post_workflow (
  post_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'planned',
  reddit_url TEXT,
  draft_title TEXT,
  draft_body TEXT,
  first_comment TEXT,
  llm_model TEXT,
  posted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS valuation_hallucination.reddit_opportunities (
  post_id TEXT PRIMARY KEY,
  source_post_id TEXT NOT NULL,
  subreddit TEXT NOT NULL,
  source_url TEXT NOT NULL UNIQUE,
  source_title TEXT NOT NULL,
  source_excerpt TEXT,
  source_published_at TIMESTAMPTZ,
  feed_type TEXT NOT NULL DEFAULT 'new',
  score INTEGER NOT NULL DEFAULT 0,
  phase TEXT NOT NULL,
  angle TEXT NOT NULL,
  cta TEXT NOT NULL,
  link_mode TEXT NOT NULL DEFAULT 'none',
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reddit_opportunities_rank_idx
  ON valuation_hallucination.reddit_opportunities (last_seen_at DESC, score DESC);
