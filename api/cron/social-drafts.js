import { growthDatabase } from "../../lib/growth.js";
import { generateSocialDrafts, storeSocialDrafts } from "../../lib/social-drafts.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ detail: "Method not allowed." });
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ detail: "Unauthorized." });
  }
  const db = await growthDatabase();
  if (!db) return res.status(503).json({ detail: "Growth database is not configured." });
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  try {
    const existing = await db.query(`SELECT count(DISTINCT channel)::int AS count FROM valuation_hallucination.social_campaign_posts WHERE campaign_day=$1`, [day]);
    if (existing.rows[0].count === 4) return res.status(200).json({ day, created: 0 });
    const posts = await generateSocialDrafts(day);
    const ids = await storeSocialDrafts(db, day, posts);
    return res.status(200).json({ day, created: ids.length });
  } catch (error) {
    console.error("social_draft_cron_error", error.message);
    return res.status(502).json({ detail: "Daily social drafts could not be generated." });
  }
}
