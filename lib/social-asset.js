import crypto from "node:crypto";
import { growthDatabase } from "./growth.js";

export default async function socialAsset(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ detail: "Method not allowed." });
  const expected = process.env.SOCIAL_AGENT_INGEST_TOKEN || "";
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a,b)) return res.status(401).json({ detail: "Unauthorized." });
  let input;
  try { input = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}; }
  catch { return res.status(400).json({ detail: "Invalid JSON." }); }
  const id = Number(input.post_id);
  const asset = String(input.asset_url || "").trim();
  if (!Number.isSafeInteger(id) || id < 1 || !/^https:\/\/drive\.google\.com\/file\/d\/[\w-]+\//.test(asset) || asset.length > 1000) {
    return res.status(400).json({ detail: "Provide a valid post_id and Google Drive file link." });
  }
  const db = await growthDatabase();
  if (!db) return res.status(503).json({ detail: "Growth database is not configured." });
  try {
    const result = await db.query(`UPDATE valuation_hallucination.social_campaign_posts
      SET asset_url=$2, updated_at=NOW() WHERE id=$1 AND status IN ('draft','changes_requested')
      RETURNING id`, [id,asset]);
    if (!result.rowCount) return res.status(404).json({ detail: "Editable draft not found." });
    return res.status(200).json({ post_id:id, asset_url:asset, status:"awaiting_review" });
  } catch (error) {
    console.error("social_asset_error",error.message);
    return res.status(500).json({ detail: "Could not attach asset." });
  }
}
