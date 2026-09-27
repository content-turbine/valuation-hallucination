import crypto from "node:crypto";
import { growthDatabase } from "./growth.js";

// A read-only capability for visual agents. Never exposes the growth admin token,
// founder records, Reddit queue, or approval controls.
export default async function socialBrief(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") return res.status(405).json({ detail: "Method not allowed." });
  const expected = process.env.SOCIAL_AGENT_BRIEF_TOKEN || "";
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a,b)) return res.status(401).json({ detail: "Unauthorized." });
  const db = await growthDatabase();
  if (!db) return res.status(503).json({ detail: "Growth database is not configured." });
  try {
    const rows = await db.query(`SELECT id, campaign_day::text, channel, caption, asset_brief,
      source_url, rationale, asset_url, status FROM valuation_hallucination.social_campaign_posts
      WHERE status IN ('draft','changes_requested') AND campaign_day >=
        ((NOW() AT TIME ZONE 'America/Toronto')::date - INTERVAL '2 days')
      ORDER BY campaign_day DESC, id DESC LIMIT 16`);
    return res.status(200).json({ asset_folder: "https://drive.google.com/drive/folders/1P9dQSR_9i66kqSRfVQatyTtH4ylWOA9I",
      drafts: rows.rows });
  } catch (error) {
    console.error("social_brief_error", error.message);
    return res.status(500).json({ detail: "Could not load visual briefs." });
  }
}
