CREATE SCHEMA IF NOT EXISTS valuation_hallucination;

CREATE TABLE IF NOT EXISTS valuation_hallucination.market_event_runs (
  id TEXT PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL,
  market_date DATE,
  candidates_json JSONB NOT NULL,
  selected_index INTEGER NOT NULL DEFAULT 0,
  selection_method TEXT NOT NULL DEFAULT 'automatic',
  slack_channel_id TEXT,
  slack_thread_ts TEXT
);

ALTER TABLE valuation_hallucination.market_event_runs
  ADD COLUMN IF NOT EXISTS market_date DATE;

CREATE UNIQUE INDEX IF NOT EXISTS market_event_runs_market_date_idx
  ON valuation_hallucination.market_event_runs (market_date);

CREATE INDEX IF NOT EXISTS market_event_runs_generated_at_idx
  ON valuation_hallucination.market_event_runs (generated_at DESC);

CREATE INDEX IF NOT EXISTS market_event_runs_slack_thread_idx
  ON valuation_hallucination.market_event_runs (slack_thread_ts)
  WHERE slack_thread_ts IS NOT NULL;
