CREATE SCHEMA IF NOT EXISTS valuation_hallucination;

CREATE TABLE IF NOT EXISTS valuation_hallucination.card_votes (
  founder_id BIGINT PRIMARY KEY REFERENCES valuation_hallucination.waitlist(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  vote_weight INTEGER NOT NULL DEFAULT 1 CHECK (vote_weight IN (1, 2)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS card_votes_card_id_idx
  ON valuation_hallucination.card_votes (card_id);
