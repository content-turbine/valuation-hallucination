import crypto from "node:crypto";
import redditFeed from "../../lib/reddit-feed.js";
import { authorized, growthDatabase, safeUrl } from "../../lib/growth.js";
import { nextPostRecommendation, normalizedPostStatus, redditSubreddits } from "../../lib/reddit-content.js";
import { generateRedditDraft } from "../../lib/reddit-drafts.js";
import { loadRedditQueue, opportunityRowToPost, syncRedditOpportunities } from "../../lib/reddit-scan.js";
import socialHandler from "../../lib/social-admin.js";
import socialIntake from "../../lib/social-intake.js";
import socialBrief from "../../lib/social-brief.js";
import socialAsset from "../../lib/social-asset.js";

const allowedStatuses = new Set(["planned", "draft", "ready", "approved", "scheduled", "posted", "skipped", "blocked", "archived"]);

function requestBody(req) {
  if (typeof req.body !== "string") return req.body || {};
  return JSON.parse(req.body || "{}");
}

async function scanAction(db, res) {
  const scan = await syncRedditOpportunities(db);
  if (!scan.items.length) {
    return res.status(502).json({
      detail: "Reddit returned no usable feed items.",
      communities: scan.communities,
      screened_out: scan.screened_out,
      errors: scan.errors
    });
  }
  return res.status(200).json({
    ok: true,
    scanned_at: scan.scanned_at,
    communities: scan.communities,
    opportunities: scan.items.length,
    screened_out: scan.screened_out,
    errors: scan.errors
  });
}

async function draftAction(db, body, res) {
  const opportunity = await db.query(
    `SELECT o.*, w.status, w.reddit_url, w.draft_title, w.draft_body,
       w.first_comment, w.llm_model, w.posted_at, w.scheduled_at, w.updated_at
     FROM valuation_hallucination.reddit_opportunities o
     LEFT JOIN valuation_hallucination.reddit_post_workflow w ON w.post_id = o.post_id
     WHERE o.post_id = $1`,
    [String(body.post_id || "").slice(0, 120)]
  );
  if (!opportunity.rowCount) return res.status(404).json({ detail: "Reddit opportunity was not found." });
  if (["scheduled", "posted"].includes(opportunity.rows[0].status)) return res.status(409).json({ detail: "Return this post to review before regenerating its copy." });
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
}

async function statusAction(db, body, res) {
  const postId = String(body.post_id || "").slice(0, 120);
  const requestedStatus = String(body.status || "").toLowerCase();
  if (!allowedStatuses.has(requestedStatus)) return res.status(400).json({ detail: "Invalid post status." });
  const status = normalizedPostStatus(requestedStatus);
  const redditUrl = body.reddit_url ? safeUrl(body.reddit_url, 800) : "";
  if (redditUrl && !/^https:\/\/(?:www\.|old\.)?reddit\.com\//i.test(redditUrl))
    return res.status(400).json({ detail: "Use the published Reddit post URL." });
  if (status === 'posted' && !redditUrl)
    return res.status(400).json({ detail: "Add the published Reddit URL before marking it posted." });
  let scheduledAt = null;
  if (status === 'scheduled') {
    scheduledAt = new Date(body.scheduled_at || '');
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now())
      return res.status(400).json({ detail: "Choose a future posting time before scheduling." });
  }
  const opportunity = await db.query(
    `SELECT o.post_id, w.draft_title, w.draft_body
       FROM valuation_hallucination.reddit_opportunities o
       LEFT JOIN valuation_hallucination.reddit_post_workflow w ON w.post_id=o.post_id
       WHERE o.post_id=$1`, [postId]
  );
  if (!opportunity.rowCount) return res.status(404).json({ detail: "Reddit opportunity was not found." });
  const title = body.draft_title === undefined ? opportunity.rows[0].draft_title : String(body.draft_title).trim().slice(0, 240);
  const draftBody = body.draft_body === undefined ? opportunity.rows[0].draft_body : String(body.draft_body).trim().slice(0, 12000);
  const comment = body.first_comment === undefined ? null : String(body.first_comment).trim().slice(0, 2000);
  if (['approved', 'ready', 'scheduled'].includes(status) && (!title || !draftBody))
    return res.status(400).json({ detail: "Generate and review the Reddit copy before approving or scheduling." });
  const result = await db.query(
    `INSERT INTO valuation_hallucination.reddit_post_workflow
      (post_id, status, reddit_url, posted_at, scheduled_at, draft_title, draft_body, first_comment, updated_at)
     VALUES ($1, $2, $3, CASE WHEN $2='posted' THEN NOW() ELSE NULL END, $4, $5, $6, $7, NOW())
     ON CONFLICT (post_id) DO UPDATE SET
       status=EXCLUDED.status,
       reddit_url=EXCLUDED.reddit_url,
       posted_at=CASE WHEN EXCLUDED.status='posted' THEN COALESCE(valuation_hallucination.reddit_post_workflow.posted_at,NOW()) ELSE NULL END,
       scheduled_at=EXCLUDED.scheduled_at,
       draft_title=COALESCE(EXCLUDED.draft_title,valuation_hallucination.reddit_post_workflow.draft_title),
       draft_body=COALESCE(EXCLUDED.draft_body,valuation_hallucination.reddit_post_workflow.draft_body),
       first_comment=COALESCE(EXCLUDED.first_comment,valuation_hallucination.reddit_post_workflow.first_comment),
       updated_at=NOW()
     RETURNING post_id,status,reddit_url,posted_at,scheduled_at,updated_at`,
    [postId, status, status === 'posted' ? redditUrl : null, scheduledAt, title, draftBody, comment]
  );
  return res.status(200).json(result.rows[0]);
}

export default async function handler(req, res) {
  if (req.query?.view === "reddit_feed") return redditFeed(req, res);
  if (req.query?.view === "brief") return socialBrief(req, res);
  if (req.query?.view === "asset") return socialAsset(req, res);
  if (req.query?.view === "submit") return socialIntake(req, res);
  if (req.query?.view === "social") return socialHandler(req, res);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!["GET", "POST", "PATCH"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, PATCH");
    return res.status(405).json({ detail: "Method not allowed." });
  }
  if (!authorized(req)) return res.status(401).json({ detail: "Unauthorized." });
  const db = await growthDatabase();
  if (!db) return res.status(503).json({ detail: "Growth database is not configured." });

  try {
    if (req.method !== "GET") {
      let body;
      try {
        body = requestBody(req);
      } catch {
        return res.status(400).json({ detail: "Invalid request." });
      }
      if (req.method === "POST" && body.action === "create_reddit_feed_access") {
        const token=crypto.randomBytes(32).toString("base64url");
        const hash=crypto.createHash("sha256").update(token).digest("hex");
        await db.query(`INSERT INTO valuation_hallucination.reddit_feed_access (id,token_hash,created_at)
          VALUES (1,$1,NOW()) ON CONFLICT (id) DO UPDATE SET token_hash=EXCLUDED.token_hash,created_at=NOW()`,[hash]);
        return res.status(200).json({ feed_url:"https://www.valuationhallucination.com/api/admin/growth?view=reddit_feed",
          username:"growth", password:token });
      }
      if (req.method === "POST" && body.action === "scan") return await scanAction(db, res);
      if (req.method === "POST" && body.action === "draft") return await draftAction(db, body, res);
      if (req.method === "PATCH" && body.action === "status") return await statusAction(db, body, res);
      return res.status(400).json({ detail: "Unknown growth action." });
    }
    const includeArchived = String(req.query?.include_archived || "").toLowerCase() === "true";
    let scanSummary = null;
    const scanState = await db.query(
      `SELECT MAX(last_seen_at) FILTER (WHERE context_relevant = TRUE) AS last_scanned_at,
         COUNT(*) FILTER (WHERE context_relevant = TRUE)::int AS opportunities
       FROM valuation_hallucination.reddit_opportunities`
    );
    const lastScan = scanState.rows[0]?.last_scanned_at;
    if (!lastScan || Date.now() - new Date(lastScan).getTime() > 12 * 3600000) {
      try {
        const scan = await syncRedditOpportunities(db);
        scanSummary = {
          last_scanned_at: scan.scanned_at,
          opportunities: scan.items.length,
          screened_out: scan.screened_out,
          communities: scan.communities,
          errors: scan.errors
        };
      } catch (error) {
        console.error("growth_reddit_scan_error", error.message);
      }
    }
    const [totals, funnel, campaigns, daily, referrals, recent, queue] = await Promise.all([
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
        SELECT 'VH-' || LPAD(id::text, 5, '0') AS founder_id, email, referral_count,
          CASE
            WHEN NULLIF(subreddit, '') IS NOT NULL THEN 'r/' || subreddit
            WHEN NULLIF(utm_source, '') IS NOT NULL AND utm_source NOT IN ('direct', 'coming-soon') THEN utm_source
            WHEN NULLIF(source, '') IS NOT NULL AND source NOT IN ('direct', 'coming-soon') THEN source
            ELSE 'Original site / direct'
          END AS origin
        FROM valuation_hallucination.waitlist
        WHERE referral_count > 0
        ORDER BY referral_count DESC, created_at ASC
        LIMIT 20
      `),
      db.query(`
        SELECT 'VH-' || LPAD(id::text, 5, '0') AS founder_id, email,
          CASE
            WHEN NULLIF(subreddit, '') IS NOT NULL THEN 'r/' || subreddit
            WHEN NULLIF(utm_source, '') IS NOT NULL AND utm_source NOT IN ('direct', 'coming-soon') THEN utm_source
            WHEN NULLIF(source, '') IS NOT NULL AND source NOT IN ('direct', 'coming-soon') THEN source
            ELSE 'Original site / direct'
          END AS origin,
          COALESCE(utm_content, utm_campaign, '') AS content,
          referral_count, created_at
        FROM valuation_hallucination.waitlist
        ORDER BY created_at DESC LIMIT 25
      `),
      loadRedditQueue(db, 60, includeArchived)
    ]);

    const funnelMap = Object.fromEntries(funnel.rows.map((row) => [row.event_name, row.count]));
    const performance = campaigns.rows.map((row) => ({
      ...row,
      conversion_rate: row.views ? Number(((row.signups / row.views) * 100).toFixed(1)) : 0
    }));
    const resolvedScan = scanSummary || {
      last_scanned_at: lastScan,
      opportunities: scanState.rows[0]?.opportunities || queue.length,
      communities: redditSubreddits(),
      screened_out: 0,
      errors: []
    };
    const feedAccess = await db.query("SELECT 1 FROM valuation_hallucination.reddit_feed_access WHERE id=1");
    return res.status(200).json({
      reddit_feed_configured: feedAccess.rowCount > 0,
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
      reddit_queue: queue,
      next_post: nextPostRecommendation(performance, queue),
      reddit_scan: resolvedScan,
      ai_drafting: {
        configured: Boolean(process.env.PERPLEXITY_API_KEY),
        model: process.env.PERPLEXITY_MODEL || "perplexity/glm-5.3-flash"
      }
    });
  } catch (error) {
    console.error("growth_dashboard_error", error.message);
    return res.status(500).json({ detail: "Could not load growth reporting." });
  }
}
