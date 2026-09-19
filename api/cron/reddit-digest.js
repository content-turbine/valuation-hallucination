import { growthDatabase, notifyGrowth } from "../../lib/growth.js";
import { scheduledPostRecommendation } from "../../lib/reddit-content.js";

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
    const result = await db.query(`
      SELECT source, COALESCE(campaign, '') AS campaign, COALESCE(content, '') AS content,
        COALESCE(subreddit, '') AS subreddit,
        COUNT(*) FILTER (WHERE event_name = 'page_view')::int AS views,
        COUNT(*) FILTER (WHERE event_name = 'waitlist_signup')::int AS signups
      FROM valuation_hallucination.growth_events
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY source, campaign, content, subreddit
      ORDER BY signups DESC, views DESC LIMIT 20
    `);
    const post = scheduledPostRecommendation(result.rows);
    const params = new URLSearchParams({
      utm_source: "reddit",
      utm_medium: "organic",
      utm_campaign: "prelaunch",
      utm_content: post.id,
      subreddit: post.subreddit
    });
    const base = process.env.PUBLIC_SITE_URL || "https://www.valuationhallucination.com";
    await notifyGrowth(`🧠 *Reddit draft for human review*\n*r/${post.subreddit}*\n*${post.title}*\n${post.angle}\nCTA: ${post.cta}\nTracked link (only if community rules permit): ${base}/?${params}\nWhy this test: ${post.reason}\n\nNothing has been posted automatically.`);
    return res.status(200).json({ ok: true, post_id: post.id, subreddit: post.subreddit });
  } catch (error) {
    console.error("reddit_digest_error", error.message);
    return res.status(500).json({ detail: "Could not prepare the Reddit digest." });
  }
}

