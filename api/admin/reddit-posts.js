import { authorized, growthDatabase, safeUrl } from "../../lib/growth.js";
import { normalizedPostStatus } from "../../lib/reddit-content.js";

const allowedStatuses = new Set(["planned", "draft", "ready", "posted", "skipped", "blocked"]);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
    return res.status(405).json({ detail: "Method not allowed." });
  }
  if (!authorized(req)) return res.status(401).json({ detail: "Unauthorized." });

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  } catch {
    return res.status(400).json({ detail: "Invalid request." });
  }

  const postId = String(body.post_id || "").slice(0, 120);
  const status = normalizedPostStatus(body.status);
  if (!allowedStatuses.has(status)) return res.status(400).json({ detail: "Invalid post status." });
  const redditUrl = body.reddit_url ? safeUrl(body.reddit_url, 800) : "";
  if (redditUrl && !/^https:\/\/(?:www\.|old\.)?reddit\.com\//i.test(redditUrl)) {
    return res.status(400).json({ detail: "Use the published Reddit post URL." });
  }

  const db = await growthDatabase();
  if (!db) return res.status(503).json({ detail: "Growth database is not configured." });
  try {
    const exists = await db.query(
      `SELECT 1 FROM valuation_hallucination.reddit_opportunities WHERE post_id = $1`,
      [postId]
    );
    if (!exists.rowCount) return res.status(404).json({ detail: "Reddit opportunity was not found." });
    const result = await db.query(
      `INSERT INTO valuation_hallucination.reddit_post_workflow
        (post_id, status, reddit_url, posted_at, updated_at)
       VALUES ($1, $2, $3, CASE WHEN $2 = 'posted' THEN NOW() ELSE NULL END, NOW())
       ON CONFLICT (post_id) DO UPDATE SET
         status = EXCLUDED.status,
         reddit_url = COALESCE(NULLIF(EXCLUDED.reddit_url, ''), valuation_hallucination.reddit_post_workflow.reddit_url),
         posted_at = CASE
           WHEN EXCLUDED.status = 'posted' THEN COALESCE(valuation_hallucination.reddit_post_workflow.posted_at, NOW())
           ELSE NULL
         END,
         updated_at = NOW()
       RETURNING post_id, status, reddit_url, posted_at, updated_at`,
      [postId, status, redditUrl || null]
    );
    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("reddit_post_update_error", error.message);
    return res.status(500).json({ detail: "Could not update the Reddit post." });
  }
}
