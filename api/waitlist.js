import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
let pool;
let initialized = false;

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
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS waitlist_referral_code_idx
        ON valuation_hallucination.waitlist (referral_code);
    `);
    initialized = true;
  }
  return pool;
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return json(res, 200, { ok: true, service: "valuation-hallucination-waitlist" });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { detail: "Method not allowed." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  if (body.website) return json(res, 200, { status: "joined" });

  const email = normalizeEmail(body.email);
  if (!validEmail(email)) return json(res, 400, { detail: "Enter a valid email address." });

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
    if (existing.rowCount) {
      row = existing.rows[0];
    } else {
      status = "joined";
      const referredBy = String(body.referred_by || "").trim().toUpperCase().slice(0, 20) || null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const inserted = await client.query(
            `INSERT INTO valuation_hallucination.waitlist
              (email, email_normalized, referral_code, referred_by, source, consent_text)
             VALUES ($1, $1, $2, $3, $4, $5)
             RETURNING id, referral_code, referral_count`,
            [
              email,
              referralCode(),
              referredBy,
              String(body.source || "coming-soon").slice(0, 80),
              "Kickstarter launch and Valuation Hallucination game updates; unsubscribe anytime."
            ]
          );
          row = inserted.rows[0];
          break;
        } catch (error) {
          if (error.code !== "23505" || attempt === 2) throw error;
        }
      }

      if (referredBy && referredBy !== row.referral_code) {
        await client.query(
          `UPDATE valuation_hallucination.waitlist
           SET referral_count = referral_count + 1
           WHERE referral_code = $1`,
          [referredBy]
        );
      }
    }

    const positionResult = await client.query(
      `SELECT COUNT(*)::int AS position
       FROM valuation_hallucination.waitlist
       WHERE id <= $1`,
      [row.id]
    );
    await client.query("COMMIT");

    return json(res, 200, {
      status,
      position: positionResult.rows[0].position,
      referral_code: row.referral_code,
      referral_count: row.referral_count,
      persona: personaFor(email, row.referral_count)
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("waitlist_error", error.code || error.message);
    return json(res, 500, { detail: "The cap table glitched. Please try again." });
  } finally {
    client.release();
  }
}
