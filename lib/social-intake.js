import crypto from "node:crypto";
import { growthDatabase } from "./growth.js";

const clip = (value, max) => String(value ?? "").trim().slice(0, max);
const channels = new Set(["instagram", "tiktok", "x", "facebook"]);

export default async function socialIntake(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ detail: "Method not allowed." });
  const expected = process.env.SOCIAL_AGENT_INGEST_TOKEN || "";
  const supplied = clip(req.headers.authorization, 500).replace(/^Bearer\s+/i, "");
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a,b)) return res.status(401).json({ detail: "Unauthorized." });
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ detail: "Invalid JSON." }); }
  const producer = clip(body?.producer, 60);
  const reference = clip(body?.reference, 120);
  const day = clip(body?.campaign_day, 10);
  const posts = body?.posts;
  if (!producer || !reference || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Array.isArray(posts) || posts.length < 1 || posts.length > 4 ||
      posts.some(p => !channels.has(p?.channel) || !clip(p.caption,5000) || !clip(p.asset_brief,2000))) {
    return res.status(400).json({ detail: "Submit a producer, reference, campaign day, and one to four channel drafts." });
  }
  const db = await growthDatabase();
  if (!db) return res.status(503).json({ detail: "Growth database is not configured." });
  try {
    const ids = [];
    for (const post of posts) {
      const source = clip(post.source_url,1000);
      const asset = clip(post.asset_url,1000);
      if (source && !/^https:\/\//i.test(source)) return res.status(400).json({ detail: "Source links must use HTTPS." });
      if (asset && !/^https:\/\/drive\.google\.com\/file\/d\/[\w-]+\//.test(asset)) return res.status(400).json({ detail: "Asset links must point to a Google Drive file." });
      const key = crypto.createHash("sha256").update(`${producer}:${reference}:${post.channel}`).digest("hex");
      const result = await db.query(`INSERT INTO valuation_hallucination.social_campaign_posts
        (campaign_day,channel,theme,caption,asset_brief,asset_url,source_url,rationale,producer,submission_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (submission_key) DO NOTHING RETURNING id`,
        [day,post.channel,clip(post.theme,160),clip(post.caption,5000),clip(post.asset_brief,2000),asset,source,
         clip(post.rationale,1000),producer,key]);
      if (result.rowCount) ids.push(result.rows[0].id);
    }
    return res.status(200).json({ received: posts.length, created: ids.length, ids });
  } catch (error) {
    console.error("social_intake_error",error.message);
    return res.status(500).json({ detail: "Could not save agent suggestions." });
  }
}
