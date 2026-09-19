CREATE SCHEMA IF NOT EXISTS valuation_hallucination;

CREATE TABLE IF NOT EXISTS valuation_hallucination.waitlist (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  referral_code TEXT NOT NULL UNIQUE,
  referred_by TEXT,
  referral_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'coming-soon',
  consent_text TEXT NOT NULL,
  consent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS waitlist_referral_code_idx
  ON valuation_hallucination.waitlist (referral_code);
