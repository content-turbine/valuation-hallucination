import { attributionFrom, growthDatabase, recordEvent, safeEventName } from "../lib/growth.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "GET") {
    const id = Number(req.query?.social);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).end();
    try {
      const db = await growthDatabase();
      if (!db) return res.status(503).end();
      const result = await db.query(`SELECT channel,destination_url FROM valuation_hallucination.social_campaign_posts WHERE id=$1`, [id]);
      if (!result.rowCount) return res.status(404).end();
      const post = result.rows[0];
      const url = new URL(post.destination_url || 'https://www.valuationhallucination.com/');
      if (url.protocol !== 'https:' || !['valuationhallucination.com','www.valuationhallucination.com'].includes(url.hostname)) return res.status(400).end();
      url.searchParams.set('utm_source', post.channel);
      url.searchParams.set('utm_medium', 'organic');
      url.searchParams.set('utm_campaign', 'valuation-hallucination-launch');
      url.searchParams.set('utm_content', `social-${id}`);
      return res.redirect(302, url.toString());
    } catch (error) { console.error('social_click_error', error.message); return res.status(500).end(); }
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ detail: "Method not allowed." });
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const eventName = safeEventName(body.event_name);
    if (!eventName || eventName === "waitlist_signup" || eventName === "referral_qualified" || eventName === "milestone_unlocked") {
      return res.status(400).json({ detail: "Unsupported client event." });
    }
    const db = await growthDatabase();
    if (!db) return res.status(202).json({ accepted: false, reason: "tracking-not-configured" });
    await recordEvent(db, eventName, attributionFrom(body), body.properties || {});
    return res.status(202).json({ accepted: true });
  } catch (error) {
    console.error("growth_event_error", error.message);
    return res.status(202).json({ accepted: false });
  }
}

