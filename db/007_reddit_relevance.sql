ALTER TABLE valuation_hallucination.reddit_opportunities
  ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS context_score INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS relevance_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS context_relevant BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS reddit_opportunities_relevance_idx
  ON valuation_hallucination.reddit_opportunities
  (context_relevant, last_seen_at DESC, context_score DESC);
