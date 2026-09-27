import crypto from "node:crypto";
import { growthDatabase } from "../lib/growth.js";

const xml = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  const db=await growthDatabase();
  if (!db) return res.status(503).end();
  const access=await db.query("SELECT token_hash FROM valuation_hallucination.reddit_feed_access WHERE id=1");
  const header=String(req.headers.authorization || "");
  let password="";
  if (header.startsWith("Basic ")) {
    try {
      const decoded=Buffer.from(header.slice(6),"base64").toString("utf8");
      const separator=decoded.indexOf(":");
      if (decoded.slice(0,separator)==="growth") password=decoded.slice(separator+1);
    } catch {}
  }
  const hash=crypto.createHash("sha256").update(password).digest();
  const expected=access.rows[0]?.token_hash;
  if (!expected || !password || !/^[a-f0-9]{64}$/i.test(expected) ||
      !crypto.timingSafeEqual(hash,Buffer.from(expected,"hex"))) {
    res.setHeader("WWW-Authenticate",'Basic realm="Growth Reddit feed"');
    return res.status(401).end();
  }
  const subreddit=String(req.query?.subreddit || "").trim();
  if (subreddit && !/^[A-Za-z0-9_]{2,40}$/.test(subreddit)) return res.status(400).end();
  const result=await db.query(`SELECT w.post_id,w.draft_title,w.draft_body,w.scheduled_at,
      o.subreddit,o.source_url
      FROM valuation_hallucination.reddit_post_workflow w
      JOIN valuation_hallucination.reddit_opportunities o ON o.post_id=w.post_id
      WHERE w.status='scheduled' AND w.scheduled_at <= NOW()
        AND w.scheduled_at > NOW()-INTERVAL '24 hours'
        AND NULLIF(TRIM(w.draft_title),'') IS NOT NULL
        AND NULLIF(TRIM(w.draft_body),'') IS NOT NULL
        AND ($1::text IS NULL OR lower(o.subreddit)=lower($1))
      ORDER BY w.scheduled_at ASC LIMIT 50`,[subreddit || null]);
  const items=result.rows.map(post=>`<item>
    <guid isPermaLink="false">${xml(`${post.post_id}:${new Date(post.scheduled_at).toISOString()}`)}</guid>
    <title>${xml(post.draft_title)}</title>
    <description>${xml(post.draft_body)}</description>
    <category>${xml(post.subreddit)}</category>
    <link>${xml(post.source_url)}</link>
    <pubDate>${new Date(post.scheduled_at).toUTCString()}</pubDate>
  </item>`).join("");
  res.setHeader("Content-Type","application/rss+xml; charset=utf-8");
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Valuation Hallucination approved Reddit posts</title>
<link>https://www.valuationhallucination.com/growth</link>
<description>Reddit drafts approved in Growth and due for publication.</description>
${items}</channel></rss>`);
}
