import { authorized, growthDatabase } from "../../lib/growth.js";
import { nextPostRecommendation, redditQueue } from "../../lib/reddit-content.js";

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

  try {
    const [totals, funnel, campaigns, daily, referrals, recent] = await Promise.all([
      db.query(`
        SELECT
          COUNT(*)::int AS founders,
          COALESCE(SUM(referral_count), 0)::int AS referrals,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS founders_7d,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS founders_30d
        FROM valuation_hallucination.waitlist
      `),
      db.query(`
        SELECT event_name, COUNT(*)::int AS count
        FROM valuation_hallucination.growth_events
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY event_name
      `),
      db.query(`
        SELECT source, COALESCE(campaign, '') AS campaign, COALESCE(content, '') AS content,
          COALESCE(subreddit, '') AS subreddit,
          COUNT(*) FILTER (WHERE event_name = 'page_view')::int AS views,
          COUNT(*) FILTER (WHERE event_name = 'waitlist_start')::int AS starts,
          COUNT(*) FILTER (WHERE event_name = 'waitlist_signup')::int AS signups,
          COUNT(*) FILTER (WHERE event_name = 'referral_qualified')::int AS referrals
        FROM valuation_hallucination.growth_events
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY source, campaign, content, subreddit
        HAVING COUNT(*) FILTER (WHERE event_name IN ('page_view','waitlist_signup')) > 0
        ORDER BY signups DESC, views DESC
        LIMIT 100
      `),
      db.query(`
        SELECT TO_CHAR(day, 'YYYY-MM-DD') AS day,
          COUNT(*) FILTER (WHERE event_name = 'page_view')::int AS views,
          COUNT(*) FILTER (WHERE event_name = 'waitlist_signup')::int AS signups
        FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day') day
        LEFT JOIN valuation_hallucination.growth_events e
          ON e.created_at >= day AND e.created_at < day + INTERVAL '1 day'
        GROUP BY day ORDER BY day
      `),
      db.query(`
        SELECT 'VH-' || LPAD(id::text, 5, '0') AS founder_id, referral_count,
          COALESCE(subreddit, utm_source, source) AS origin
        FROM valuation_hallucination.waitlist
        WHERE referral_count > 0
        ORDER BY referral_count DESC, created_at ASC
        LIMIT 20
      `),
      db.query(`
        SELECT 'VH-' || LPAD(id::text, 5, '0') AS founder_id,
          COALESCE(subreddit, utm_source, source) AS origin,
          COALESCE(utm_content, utm_campaign, '') AS content,
          referral_count, created_at
        FROM valuation_hallucination.waitlist
        ORDER BY created_at DESC LIMIT 25
      `)
    ]);

    const funnelMap = Object.fromEntries(funnel.rows.map((row) => [row.event_name, row.count]));
    const performance = campaigns.rows.map((row) => ({
      ...row,
      conversion_rate: row.views ? Number(((row.signups / row.views) * 100).toFixed(1)) : 0
    }));
    return res.status(200).json({
      generated_at: new Date().toISOString(),
      totals: totals.rows[0],
      funnel: {
        views: funnelMap.page_view || 0,
        starts: funnelMap.waitlist_start || 0,
        signups: funnelMap.waitlist_signup || 0,
        referrals: funnelMap.referral_qualified || 0,
        link_copies: funnelMap.referral_link_copy || 0
      },
      campaigns: performance,
      daily: daily.rows,
      referral_leaders: referrals.rows,
      recent_founders: recent.rows,
      reddit_queue: redditQueue,
      next_post: nextPostRecommendation(performance)
    });
  } catch (error) {
    console.error("growth_dashboard_error", error.message);
    return res.status(500).json({ detail: "Could not load growth reporting." });
  }
}

