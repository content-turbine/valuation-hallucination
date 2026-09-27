import { authorized, growthDatabase } from "./growth.js";
import { generateReviewedSocialDrafts, storeSocialDrafts } from "./social-drafts.js";
import { connectedVoholabsChannels } from "./voholabs.js";

const channels = new Set(["instagram", "tiktok", "x", "facebook"]);
const editable = new Set(["draft", "changes_requested", "approved", "failed"]);
const limited = (value, length) => String(value ?? "").trim().slice(0, length);

function bodyOf(req) {
  return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

function normalize(input) {
  const channel = limited(input.channel, 20).toLowerCase();
  const day = limited(input.campaign_day, 10);
  if (!channels.has(channel) || !validDate(day)) throw new Error("Choose a channel and valid campaign date.");
  const scheduled = input.scheduled_at ? new Date(input.scheduled_at) : null;
  if (scheduled && Number.isNaN(scheduled.getTime())) throw new Error("Choose a valid posting time.");
  const media = limited(input.media_url, 1000);
  const asset = limited(input.asset_url, 1000);
  if (asset && !/^https:\/\/drive\.google\.com\/file\/d\/[\w-]+\//.test(asset)) throw new Error("Use a Google Drive file link for the finished asset.");
  if (media) {
    try { if (new URL(media).protocol !== "https:") throw new Error(); }
    catch { throw new Error("Media needs a public HTTPS URL."); }
  }
  const destination = limited(input.destination_url, 800) || "https://valuationhallucination.com/";
  let destinationUrl;
  try { destinationUrl = new URL(destination); } catch { throw new Error("Choose a valid game-site destination URL."); }
  if (destinationUrl.protocol !== "https:" || !["valuationhallucination.com", "www.valuationhallucination.com"].includes(destinationUrl.hostname)) {
    throw new Error("Choose a valid game-site destination URL.");
  }
  return {
    day, channel, theme: limited(input.theme, 160), caption: limited(input.caption, 5000),
    assetBrief: limited(input.asset_brief, 2000), asset, media,
    destination,
    scheduled: scheduled?.toISOString() || null
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST", "PATCH"].includes(req.method)) return res.status(405).json({ detail: "Method not allowed." });
  if (!authorized(req)) return res.status(401).json({ detail: "Unauthorized." });
  const db = await growthDatabase();
  if (!db) return res.status(503).json({ detail: "Growth database is not configured." });
  let input;
  try {
    if (req.method === "GET") {
      if (req.query?.connection === "true") {
        try { return res.status(200).json({ channels: await connectedVoholabsChannels() }); }
        catch (error) { return res.status(503).json({ detail: error.message }); }
      }
      const rows = await db.query(`SELECT id, campaign_day::text, channel, theme, caption, asset_brief, asset_url, media_url,
        destination_url, scheduled_at, status, producer, source_url, rationale, external_post_id, error_message, approved_at, updated_at
        FROM valuation_hallucination.social_campaign_posts ORDER BY campaign_day DESC, id DESC LIMIT 120`);
      return res.status(200).json({ posts: rows.rows, voholabs_configured: Boolean(process.env.VOHOLABS_API_KEY) });
    }
    input = bodyOf(req);
    if (req.method === "POST") {
      if (input.action === "generate") {
        const day = limited(input.campaign_day, 10);
        if (!validDate(day)) return res.status(400).json({ detail: "Choose a valid campaign date." });
        const posts = await generateReviewedSocialDrafts(day);
        const ids = await storeSocialDrafts(db, day, posts, "Current event", "scout → writer → editor");
        return res.status(201).json({ ids });
      }
      const p = normalize(input);
      const row = await db.query(`INSERT INTO valuation_hallucination.social_campaign_posts
        (campaign_day,channel,theme,caption,asset_brief,asset_url,media_url,destination_url,scheduled_at,producer)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual') RETURNING id`,
        [p.day,p.channel,p.theme,p.caption,p.assetBrief,p.asset,p.media,p.destination,p.scheduled]);
      return res.status(201).json({ id: row.rows[0].id });
    }
    const id = Number(input.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ detail: "Invalid post ID." });
    const existing = await db.query(`SELECT * FROM valuation_hallucination.social_campaign_posts WHERE id=$1`, [id]);
    if (!existing.rowCount) return res.status(404).json({ detail: "Post not found." });
    if (!editable.has(existing.rows[0].status)) return res.status(409).json({ detail: "Scheduled posts cannot be edited here." });
    if (input.action === "review") {
      const status = input.status;
      if (!["approved", "changes_requested", "draft"].includes(status)) return res.status(400).json({ detail: "Invalid review decision." });
      if (status === "approved" && (!existing.rows[0].caption.trim() || !existing.rows[0].scheduled_at)) {
        return res.status(400).json({ detail: "Add copy and a posting time before approval." });
      }
      if (status === "approved" && ["instagram", "tiktok"].includes(existing.rows[0].channel) && !existing.rows[0].asset_url && !existing.rows[0].media_url) {
        return res.status(400).json({ detail: "Attach the finished image or reel before approving." });
      }
      await db.query(`UPDATE valuation_hallucination.social_campaign_posts SET status=$2,
        approved_at=CASE WHEN $2='approved' THEN NOW() ELSE NULL END, updated_at=NOW() WHERE id=$1`, [id,status]);
      return res.status(200).json({ id, status });
    }
    if (input.action !== "edit") return res.status(400).json({ detail: "Unknown action." });
    const p = normalize(input);
    await db.query(`UPDATE valuation_hallucination.social_campaign_posts SET campaign_day=$2,channel=$3,theme=$4,
      caption=$5,asset_brief=$6,asset_url=$7,media_url=$8,destination_url=$9,scheduled_at=$10,status='draft',
      approved_at=NULL,error_message=NULL,updated_at=NOW() WHERE id=$1`,
      [id,p.day,p.channel,p.theme,p.caption,p.assetBrief,p.asset,p.media,p.destination,p.scheduled]);
    return res.status(200).json({ id, status: "draft" });
  } catch (error) {
    if (/^(Choose|Media needs|Use a Google Drive)/.test(error.message)) return res.status(400).json({ detail: error.message });
    console.error("growth_social_error", error.message);
    if (input?.action === "generate" && /^(AI |News scout|Writer |Editorial check|The operation was aborted)/.test(error.message)) {
      return res.status(422).json({ detail: error.message });
    }
    return res.status(500).json({ detail: "Could not update social campaigns." });
  }
}
