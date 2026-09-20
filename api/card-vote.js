import pg from "pg";
import { cardVoteState, isCardVoteChoice } from "../lib/card-vote.js";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
let pool;
let initialized = false;

function json(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.json(body);
}

async function database() {
  if (!connectionString) return null;
  if (!pool) pool = new Pool({ connectionString, max: 1, idleTimeoutMillis: 10000 });
  if (!initialized) {
    await pool.query(`
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
    `);
    initialized = true;
  }
  return pool;
}

function founderNumber(value) {
  const match = /^VH-(\d{1,12})$/i.exec(String(value || "").trim());
  return match ? Number(match[1]) : null;
}

export default async function handler(req, res) {
  const state = cardVoteState();
  const db = await database();

  if (req.method === "GET") {
    let foundersVoted = 0;
    if (db) {
      const result = await db.query("SELECT COUNT(*)::int AS count FROM valuation_hallucination.card_votes");
      foundersVoted = result.rows[0].count;
    }
    return json(res, 200, { ...state, founders_voted: foundersVoted });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { detail: "Method not allowed." });
  }

  if (!db) return json(res, 503, { detail: "Voting is not connected yet. Please try again shortly." });

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  } catch {
    return json(res, 400, { detail: "Invalid request." });
  }
  if (body.website) return json(res, 200, { status: "recorded" });
  if (!state.voting.open) {
    return json(res, 409, {
      detail: state.voting.closed ? "This Founder vote has closed." : "Voting opens after the final card is revealed.",
      voting: state.voting
    });
  }

  const founderId = founderNumber(body.founder_id);
  const cardId = String(body.card_id || "").trim();
  if (!founderId) return json(res, 400, { detail: "Enter a valid Founder ID, such as VH-00042." });
  if (!isCardVoteChoice(cardId)) return json(res, 400, { detail: "Choose one of the revealed cards." });

  const founderResult = await db.query(
    "SELECT id, referral_count FROM valuation_hallucination.waitlist WHERE id = $1",
    [founderId]
  );
  if (!founderResult.rowCount) {
    return json(res, 404, { detail: "Founder ID not found. Use the ID from your Founders’ Round signup." });
  }

  const founder = founderResult.rows[0];
  const voteWeight = founder.referral_count >= 3 ? 2 : 1;
  const previous = await db.query(
    "SELECT card_id FROM valuation_hallucination.card_votes WHERE founder_id = $1",
    [founder.id]
  );
  await db.query(
    `INSERT INTO valuation_hallucination.card_votes (founder_id, card_id, vote_weight)
     VALUES ($1, $2, $3)
     ON CONFLICT (founder_id) DO UPDATE
       SET card_id = EXCLUDED.card_id,
           vote_weight = EXCLUDED.vote_weight,
           updated_at = NOW()`,
    [founder.id, cardId, voteWeight]
  );

  return json(res, 200, {
    status: previous.rowCount ? "updated" : "recorded",
    founder_id: `VH-${String(founder.id).padStart(5, "0")}`,
    card_id: cardId,
    vote_weight: voteWeight,
    detail: previous.rowCount ? "Your Founder vote has been updated." : "Your Founder vote is on the cap table."
  });
}
