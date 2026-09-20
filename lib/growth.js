import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
let pool;
let initialized = false;

const allowedEvents = new Set([
  "page_view",
  "waitlist_start",
  "waitlist_signup",
  "referral_link_copy",
  "referral_qualified",
  "milestone_unlocked"
]);

const clean = (value, length = 160) => String(value || "").trim().slice(0, length);

export function safeEventName(value) {
  const event = clean(value, 40).toLowerCase();
  return allowedEvents.has(event) ? event : null;
}

export function safeUrl(value, length = 600) {
  const input = clean(value, length);
  if (!input) return "";
  try {
    const url = new URL(input, "https://valuationhallucination.com");
    return ["http:", "https:"].includes(url.protocol) ? url.toString().slice(0, length) : "";
  } catch {
    return "";
  }
}

export function attributionFrom(input = {}) {
  return {
    visitor_id: clean(input.visitor_id, 80),
    session_id: clean(input.session_id, 80),
    source: clean(input.utm_source || input.source || "direct", 80).toLowerCase(),
    medium: clean(input.utm_medium || "", 80).toLowerCase(),
    campaign: clean(input.utm_campaign || "", 120),
    content: clean(input.utm_content || "", 160),
    subreddit: clean(input.subreddit || "", 80).replace(/^r\//i, ""),
    reddit_post_id: clean(input.reddit_post_id || "", 40),
    referral_code: clean(input.referral_code || input.referred_by || "", 20).toUpperCase(),
    landing_path: clean(input.landing_path || "/", 300),
    referrer_url: safeUrl(input.referrer_url || input.referrer, 600)
  };
}

export function authorized(req) {
  const configured = process.env.GROWTH_ADMIN_TOKEN;
  if (!configured) return false;
  const supplied = clean(req.headers.authorization, 500).replace(/^Bearer\s+/i, "");
  const a = Buffer.from(supplied);
  const b = Buffer.from(configured);
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

export async function growthDatabase() {
  if (!connectionString) return null;
  if (!pool) pool = new Pool({ connectionString, max: 2, idleTimeoutMillis: 10000 });
  if (!initialized) {
    await pool.query(`
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
        terms_version TEXT,
        terms_accepted_at TIMESTAMPTZ,
        age_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
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
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        context_score INTEGER NOT NULL DEFAULT 0,
        relevance_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
        context_relevant BOOLEAN NOT NULL DEFAULT FALSE,
        discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE valuation_hallucination.reddit_opportunities
        ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS context_score INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS relevance_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS context_relevant BOOLEAN NOT NULL DEFAULT FALSE;
      CREATE INDEX IF NOT EXISTS growth_events_created_at_idx
        ON valuation_hallucination.growth_events (created_at DESC);
      CREATE INDEX IF NOT EXISTS growth_events_campaign_idx
        ON valuation_hallucination.growth_events (source, campaign, content);
      CREATE INDEX IF NOT EXISTS growth_events_visitor_idx
        ON valuation_hallucination.growth_events (visitor_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS waitlist_referral_code_idx
        ON valuation_hallucination.waitlist (referral_code);
      CREATE INDEX IF NOT EXISTS reddit_opportunities_rank_idx
        ON valuation_hallucination.reddit_opportunities (last_seen_at DESC, score DESC);
    `);
    initialized = true;
  }
  return pool;
}

export async function recordEvent(db, eventName, attribution, properties = {}, founderId = null) {
  const event = safeEventName(eventName);
  if (!db || !event) return false;
  const a = attributionFrom(attribution);
  await db.query(
    `INSERT INTO valuation_hallucination.growth_events
      (event_name, visitor_id, session_id, founder_id, source, medium, campaign, content,
       subreddit, reddit_post_id, referral_code, landing_path, referrer_url, properties)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
    [event, a.visitor_id || null, a.session_id || null, founderId, a.source, a.medium || null,
      a.campaign || null, a.content || null, a.subreddit || null, a.reddit_post_id || null,
      a.referral_code || null, a.landing_path || null, a.referrer_url || null,
      JSON.stringify(properties && typeof properties === "object" ? properties : {})]
  );
  return true;
}

export async function notifyGrowth(text) {
  const message = clean(text, 2500);
  if (!message) return;
  if (process.env.GROWTH_SLACK_WEBHOOK_URL) {
    const response = await fetch(process.env.GROWTH_SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message })
    });
    if (!response.ok) throw new Error(`Growth webhook returned ${response.status}`);
    return;
  }
  if (process.env.SLACK_BOT_TOKEN && process.env.VH_SLACK_CHANNEL_ID) {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel: process.env.VH_SLACK_CHANNEL_ID, text: message })
    });
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || "Slack rejected the growth message");
  }
}
