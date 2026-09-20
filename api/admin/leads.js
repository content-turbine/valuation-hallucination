import { authorized, growthDatabase } from "../../lib/growth.js";

const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ detail: "Method not allowed." });
  }
  if (!authorized(req)) return res.status(401).json({ detail: "Unauthorized." });
  const db = await growthDatabase();
  if (!db) return res.status(503).json({ detail: "Growth database is not configured." });
  const result = await db.query(`
    SELECT 'VH-' || LPAD(id::text, 5, '0') AS founder_id, email, referral_code,
      referral_count, source, utm_source, utm_medium, utm_campaign, utm_content,
      subreddit, reddit_post_id, referred_by, terms_version, consent_at, created_at
    FROM valuation_hallucination.waitlist
    ORDER BY created_at DESC
  `);
  const fields = ["founder_id","email","referral_code","referral_count","source","utm_source","utm_medium","utm_campaign","utm_content","subreddit","reddit_post_id","referred_by","terms_version","consent_at","created_at"];
  const body = [fields.map(csv).join(","), ...result.rows.map((row) => fields.map((key) => csv(row[key])).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="valuation-hallucination-leads-${new Date().toISOString().slice(0, 10)}.csv"`);
  return res.status(200).send(body);
}

