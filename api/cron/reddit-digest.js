import { growthDatabase, notifyGrowth } from "../../lib/growth.js";
import { baselineRedditDraft, generateRedditDraft } from "../../lib/reddit-drafts.js";
import { scheduledPostRecommendation } from "../../lib/reddit-content.js";
import { loadRedditQueue, syncRedditOpportunities } from "../../lib/reddit-scan.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ detail: "Method not allowed." });
  }
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!process.env.CRON_SECRET) return res.status(503).json({ detail: "Digest cron is not configured." });
  if (supplied !== process.env.CRON_SECRET) return res.status(401).json({ detail: "Unauthorized." });
  const db = await growthDatabase();
  if (!db) return res.status(503).json({ detail: "Growth database is not configured." });
  try {
    let scanErrors = [];
    try {
      const scan = await syncRedditOpportunities(db);
      scanErrors = scan.errors;
    } catch (error) {
      console.error("reddit_digest_scan_error", error.message);
    }
    const [result, queue] = await Promise.all([db.query(`
      SELECT source, COALESCE(campaign, '') AS campaign, COALESCE(content, '') AS content,
        COALESCE(subreddit, '') AS subreddit,
        COUNT(*) FILTER (WHERE event_name = 'page_view')::int AS views,
        COUNT(*) FILTER (WHERE event_name = 'waitlist_signup')::int AS signups
      FROM valuation_hallucination.growth_events
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY source, campaign, content, subreddit
      ORDER BY signups DESC, views DESC LIMIT 20
    `), loadRedditQueue(db)]);
    const post = scheduledPostRecommendation(result.rows, new Date(), queue);
    if (!post) {
      await notifyGrowth("⚠️ Reddit scan found no current publishing opportunities. Open the growth console and run Scan Reddit now.");
      return res.status(200).json({ ok: true, post_id: null, scan_errors: scanErrors });
    }
    const params = new URLSearchParams({
      utm_source: "reddit",
      utm_medium: "organic",
      utm_campaign: "prelaunch",
      utm_content: post.id,
      subreddit: post.subreddit
    });
    const base = process.env.PUBLIC_SITE_URL || "https://www.valuationhallucination.com";
    let draft = post.draft_title ? {
      title: post.draft_title,
      body: post.draft_body,
      first_comment: post.first_comment || "",
      model: post.llm_model || "saved"
    } : baselineRedditDraft(post);
    if (process.env.PERPLEXITY_API_KEY && !post.draft_title) {
      try {
        draft = await generateRedditDraft(post);
        await db.query(
          `INSERT INTO valuation_hallucination.reddit_post_workflow
            (post_id, status, draft_title, draft_body, first_comment, llm_model, updated_at)
           VALUES ($1, 'draft', $2, $3, $4, $5, NOW())
           ON CONFLICT (post_id) DO UPDATE SET draft_title = EXCLUDED.draft_title,
             draft_body = EXCLUDED.draft_body, first_comment = EXCLUDED.first_comment,
             llm_model = EXCLUDED.llm_model, updated_at = NOW()`,
          [post.id, draft.title, draft.body, draft.first_comment || null, draft.model]
        );
      } catch (error) {
        console.error("reddit_digest_ai_error", error.message);
      }
    }
    const trackedLink = `${base}/?${params}`;
    const title = String(draft.title || "").replaceAll("{{tracked_link}}", trackedLink);
    const body = String(draft.body || "").replaceAll("{{tracked_link}}", trackedLink);
    const firstComment = String(draft.first_comment || "").replaceAll("{{tracked_link}}", trackedLink);
    await notifyGrowth(`🧠 *Reddit draft for human review*\n*r/${post.subreddit}*\nSource signal: ${post.sourceUrl}\n\n*${title}*\n\n${body}\n${firstComment ? `\nFirst comment:\n${firstComment}\n` : ""}\nTracked link (only if community rules permit): ${trackedLink}\nWhy this test: ${post.reason}\n\nNothing has been posted automatically.`);
    return res.status(200).json({ ok: true, post_id: post.id, subreddit: post.subreddit });
  } catch (error) {
    console.error("reddit_digest_error", error.message);
    return res.status(500).json({ detail: "Could not prepare the Reddit digest." });
  }
}
