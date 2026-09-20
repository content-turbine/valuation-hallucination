import { authorized, growthDatabase } from "../../lib/growth.js";
import { generateRedditDraft } from "../../lib/reddit-drafts.js";
import { opportunityRowToPost } from "../../lib/reddit-scan.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ detail: "Method not allowed." });
  }
  if (!authorized(req)) return res.status(401).json({ detail: "Unauthorized." });

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  } catch {
    return res.status(400).json({ detail: "Invalid request." });
  }
  const db = await growthDatabase();
  if (!db) return res.status(503).json({ detail: "Growth database is not configured." });

  try {
    const opportunity = await db.query(
      `SELECT o.*, w.status, w.reddit_url, w.draft_title, w.draft_body,
         w.first_comment, w.llm_model, w.posted_at, w.updated_at
       FROM valuation_hallucination.reddit_opportunities o
       LEFT JOIN valuation_hallucination.reddit_post_workflow w ON w.post_id = o.post_id
       WHERE o.post_id = $1`,
      [String(body.post_id || "").slice(0, 120)]
    );
    if (!opportunity.rowCount) return res.status(404).json({ detail: "Reddit opportunity was not found." });
    const post = opportunityRowToPost(opportunity.rows[0]);
    const draft = await generateRedditDraft(post, body.instructions);
    await db.query(
      `INSERT INTO valuation_hallucination.reddit_post_workflow
        (post_id, status, draft_title, draft_body, first_comment, llm_model, updated_at)
       VALUES ($1, 'draft', $2, $3, $4, $5, NOW())
       ON CONFLICT (post_id) DO UPDATE SET
         status = CASE WHEN valuation_hallucination.reddit_post_workflow.status = 'posted'
           THEN 'posted' ELSE 'draft' END,
         draft_title = EXCLUDED.draft_title,
         draft_body = EXCLUDED.draft_body,
         first_comment = EXCLUDED.first_comment,
         llm_model = EXCLUDED.llm_model,
         updated_at = NOW()`,
      [post.id, draft.title, draft.body, draft.first_comment || null, draft.model]
    );
    return res.status(200).json({ post_id: post.id, ...draft });
  } catch (error) {
    console.error("reddit_draft_error", error.message);
    return res.status(error.code === "AI_NOT_CONFIGURED" ? 503 : 502).json({ detail: error.message });
  }
}
