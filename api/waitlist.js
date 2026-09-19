import crypto from "node:crypto";
import { waitUntil } from "@vercel/functions";
import pg from "pg";
import { attributionFrom, notifyGrowth, recordEvent } from "../lib/growth.js";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
let pool;
let initialized = false;
const termsVersion = "founders-round-2026-09-19";

const archetypes = [
  ["The Prompt Whisperer", 85],
  ["The Stealth Unicorn", 120],
  ["The Pivot Machine", 65],
  ["The Deck Optimizer", 95],
  ["The Agent Wrangler", 140],
  ["The Pre-Revenue Visionary", 110],
  ["The Growth Hacker Emeritus", 75],
  ["The Due-Diligence Dodger", 155]
];

function json(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.json(body);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function personaFor(email, referrals = 0) {
  const digest = crypto.createHash("sha256").update(email).digest();
  const [title, base] = archetypes[digest[0] % archetypes.length];
  const noise = (digest[1] % 8) * 5;
  return {
    title,
    valuation_millions: base + noise + referrals * 50
  };
}

function referralCode() {
  return crypto.randomBytes(5).toString("base64url").toUpperCase();
}

function rewardState(referrals) {
  return {
    founder_id_unlocked: true,
    valuation_bonus_millions: referrals * 50,
    vote_count: referrals >= 3 ? 2 : 1,
    second_vote_unlocked: referrals >= 3,
    cap_table_unlocked: referrals >= 5,
    founder_edition_reserved: true,
    next_referral_target: referrals < 1 ? 1 : referrals < 3 ? 3 : referrals < 5 ? 5 : null
  };
}

async function database() {
  if (!connectionString) return null;
  if (!pool) {
    pool = new Pool({ connectionString, max: 1, idleTimeoutMillis: 10000 });
  }
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
        ADD COLUMN IF NOT EXISTS terms_version TEXT,
        ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS age_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
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
      CREATE INDEX IF NOT EXISTS waitlist_referral_code_idx
        ON valuation_hallucination.waitlist (referral_code);
      CREATE INDEX IF NOT EXISTS growth_events_created_at_idx
        ON valuation_hallucination.growth_events (created_at DESC);
      CREATE INDEX IF NOT EXISTS growth_events_campaign_idx
        ON valuation_hallucination.growth_events (source, campaign, content);
    `);
    initialized = true;
  }
  return pool;
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const db = await database();
    if (!db) {
      return json(res, 503, {
        ok: false,
        service: "valuation-hallucination-waitlist",
        database: "not-configured"
      });
    }
    await db.query("SELECT 1");
    return json(res, 200, {
      ok: true,
      service: "valuation-hallucination-waitlist",
      database: "connected"
    });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { detail: "Method not allowed." });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  } catch {
    return json(res, 400, { detail: "Invalid request." });
  }
  if (body.website) return json(res, 200, { status: "joined" });

  const email = normalizeEmail(body.email);
  if (!validEmail(email)) return json(res, 400, { detail: "Enter a valid email address." });
  if (body.terms_accepted !== true || body.age_confirmed !== true) {
    return json(res, 400, { detail: "Accept the Founders’ Round Terms and confirm your age eligibility." });
  }
  if (body.marketing_consent !== true) {
    return json(res, 400, { detail: "Consent is required so we can send your voting invitation and Kickstarter launch notice." });
  }
  const smokeTest = email.endsWith("@example.invalid");
  const attribution = attributionFrom(body);

  const db = await database();
  if (!db) {
    return json(res, 503, { detail: "The cap table is opening shortly. Please try again in a few minutes." });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT id, referral_code, referral_count
       FROM valuation_hallucination.waitlist
       WHERE email_normalized = $1`,
      [email]
    );

    let row;
    let status = "already_joined";
    let referredFounder = null;
    if (existing.rowCount) {
      row = existing.rows[0];
      await client.query(
        `UPDATE valuation_hallucination.waitlist
         SET terms_version = $1, terms_accepted_at = NOW(), age_confirmed = TRUE,
             consent_text = $2, consent_at = NOW()
         WHERE id = $3`,
        [
          termsVersion,
          "Kickstarter launch, Founders’ Round voting invitations, and Valuation Hallucination game updates; unsubscribe anytime.",
          row.id
        ]
      );
    } else {
      status = "joined";
      const referredBy = String(body.referred_by || "").trim().toUpperCase().slice(0, 20) || null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const inserted = await client.query(
            `INSERT INTO valuation_hallucination.waitlist
              (email, email_normalized, referral_code, referred_by, source, consent_text,
               terms_version, terms_accepted_at, age_confirmed, visitor_id, utm_source,
               utm_medium, utm_campaign, utm_content, subreddit, reddit_post_id,
               landing_path, referrer_url)
             VALUES ($1, $1, $2, $3, $4, $5, $6, NOW(), TRUE, $7, $8, $9, $10, $11, $12, $13, $14, $15)
             RETURNING id, referral_code, referral_count`,
            [
              email,
              referralCode(),
              referredBy,
              attribution.source,
              "Kickstarter launch, Founders’ Round voting invitations, and Valuation Hallucination game updates; unsubscribe anytime.",
              termsVersion,
              attribution.visitor_id || null,
              attribution.source || null,
              attribution.medium || null,
              attribution.campaign || null,
              attribution.content || null,
              attribution.subreddit || null,
              attribution.reddit_post_id || null,
              attribution.landing_path || null,
              attribution.referrer_url || null
            ]
          );
          row = inserted.rows[0];
          break;
        } catch (error) {
          if (error.code !== "23505" || attempt === 2) throw error;
        }
      }

      if (referredBy && referredBy !== row.referral_code) {
        const referralUpdate = await client.query(
          `UPDATE valuation_hallucination.waitlist
           SET referral_count = referral_count + 1
           WHERE referral_code = $1
           RETURNING id, referral_code, referral_count`,
          [referredBy]
        );
        referredFounder = referralUpdate.rows[0] || null;
      }

      await recordEvent(client, "waitlist_signup", { ...attribution, referral_code: referredBy }, {
        status,
        founder_id: `VH-${String(row.id).padStart(5, "0")}`
      }, row.id);
      if (referredFounder) {
        await recordEvent(client, "referral_qualified", { ...attribution, referral_code: referredFounder.referral_code }, {
          referral_count: referredFounder.referral_count,
          referred_founder_id: referredFounder.id
        }, referredFounder.id);
        if ([1, 3, 5].includes(referredFounder.referral_count)) {
          await recordEvent(client, "milestone_unlocked", { ...attribution, referral_code: referredFounder.referral_code }, {
            milestone: referredFounder.referral_count,
            referral_count: referredFounder.referral_count
          }, referredFounder.id);
        }
      }
    }

    const positionResult = await client.query(
      `SELECT COUNT(*)::int AS position
       FROM valuation_hallucination.waitlist
       WHERE id <= $1`,
      [row.id]
    );
    const leaderboardResult = await client.query(
      `SELECT 1 + COUNT(*)::int AS rank
       FROM valuation_hallucination.waitlist
       WHERE referral_count > $1 OR (referral_count = $1 AND id < $2)`,
      [row.referral_count, row.id]
    );
    // Reserved .invalid addresses exercise the full transaction without
    // consuming a real waitlist position or leaving test data behind.
    await client.query(smokeTest ? "ROLLBACK" : "COMMIT");

    if (!smokeTest && status === "joined") {
      const sourceLabel = [attribution.subreddit && `r/${attribution.subreddit}`, attribution.content || attribution.campaign]
        .filter(Boolean).join(" · ") || attribution.source;
      const milestoneText = referredFounder && [1, 3, 5].includes(referredFounder.referral_count)
        ? ` Referral milestone unlocked: ${referredFounder.referral_count}.`
        : "";
      waitUntil(notifyGrowth(`🎲 New Valuation Hallucination founder from ${sourceLabel || "direct"}. Total referrals credited: ${referredFounder ? 1 : 0}.${milestoneText}`).catch((error) => {
        console.error("growth_slack_error", error.message);
      }));
    }

    return json(res, 200, {
      status,
      smoke_test: smokeTest,
      position: positionResult.rows[0].position,
      founder_id: `VH-${String(row.id).padStart(5, "0")}`,
      leaderboard_rank: leaderboardResult.rows[0].rank,
      referral_code: row.referral_code,
      referral_count: row.referral_count,
      persona: personaFor(email, row.referral_count),
      rewards: rewardState(row.referral_count),
      terms_version: termsVersion
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("waitlist_error", error.code || error.message);
    return json(res, 500, { detail: "The cap table glitched. Please try again." });
  } finally {
    client.release();
  }
}
