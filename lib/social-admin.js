import crypto from "node:crypto";
import { authorized, growthDatabase } from "./growth.js";
import { generateReviewedSocialDrafts, regenerateExistingSocialCopy, storeSocialDrafts } from "./social-drafts.js";
import { connectedVoholabsChannels, uploadVoholabsMedia, scheduleVoholabsPost, cancelQueuedVoholabsPost, getVoholabsPostStatus } from "./voholabs.js";
import { credentials, driveToken, syncSocialDriveAssets } from "./social-drive.js";

const channels = new Set(["instagram", "tiktok", "x", "facebook"]);
const editable = new Set(["draft", "changes_requested", "approved", "failed"]);
const limited = (value, length) => String(value ?? "").trim().slice(0, length);
let lastDriveSync = 0;

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
  const signedVideo = req.method === "GET" && req.query?.video === "1";
  if (signedVideo) {
    const id = String(req.query.media || "");
    const exp = Number(req.query.exp);
    const sig = String(req.query.sig || "");
    if (!/^[\w-]{10,100}$/.test(id) || !Number.isSafeInteger(exp) || exp < Date.now() || exp > Date.now() + 3600_000 || !/^[a-f0-9]{64}$/.test(sig))
      return res.status(403).end();
    const expected = crypto.createHmac("sha256", process.env.GROWTH_ADMIN_TOKEN || "").update(`${id}:${exp}`).digest("hex");
    if (!process.env.GROWTH_ADMIN_TOKEN || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return res.status(403).end();
  } else if (!authorized(req)) return res.status(401).json({ detail: "Unauthorized." });
  const db = await growthDatabase();
  if (!db) return res.status(503).json({ detail: "Growth database is not configured." });
  let input;
  try {
    if (req.method === "GET") {
      if (req.query?.media) {
        const id = String(req.query.media);
        if (!/^[\w-]{10,100}$/.test(id)) return res.status(400).json({ detail: "Invalid media ID." });
        const asset = await db.query(`SELECT 1 FROM valuation_hallucination.social_campaign_posts WHERE asset_url=$1 LIMIT 1`,
          [`https://drive.google.com/file/d/${id}/view`]);
        if (!asset.rowCount) return res.status(404).json({ detail: "Media is not in the review queue." });
        const config = credentials();
        if (!config) return res.status(503).json({ detail: "Drive is not connected." });
        const range = signedVideo && /^bytes=\d+-(?:\d+)?$/.test(String(req.headers.range || "")) ? String(req.headers.range) : "bytes=0-2097151";
        const start = Number(range.match(/^bytes=(\d+)/)[1]);
        const end = Math.min(start + 2097151, Number(range.match(/^bytes=\d+-(\d+)$/)?.[1] || (start + 2097151)));
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, {
          headers: { Authorization: `Bearer ${await driveToken(config)}`, ...(signedVideo ? { Range: `bytes=${start}-${end}` } : {}) }, signal: AbortSignal.timeout(20000)
        });
        if (!response.ok) return res.status(502).json({ detail: "Drive image preview is unavailable." });
        const type = response.headers.get("content-type")?.split(";")[0];
        if (signedVideo) {
          if (!["video/mp4", "video/webm", "video/quicktime"].includes(type) || response.status !== 206)
            return res.status(415).end();
          if (Number(response.headers.get("content-length")) > 2_097_152) return res.status(413).end();
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length > 2_097_152) return res.status(413).end();
          res.setHeader("Content-Type", type);
          res.setHeader("Content-Range", response.headers.get("content-range"));
          res.setHeader("Accept-Ranges", "bytes");
          res.setHeader("Content-Length", bytes.length);
          res.setHeader("X-Content-Type-Options", "nosniff");
          return res.status(206).send(bytes);
        }
        if (["video/mp4", "video/webm", "video/quicktime"].includes(type)) {
          const exp = Date.now() + 3600_000;
          const sig = crypto.createHmac("sha256", process.env.GROWTH_ADMIN_TOKEN).update(`${id}:${exp}`).digest("hex");
          return res.status(200).json({ video_url: `/api/admin/growth?view=social&media=${encodeURIComponent(id)}&video=1&exp=${exp}&sig=${sig}` });
        }
        if (!["image/png", "image/jpeg", "image/webp"].includes(type)) return res.status(415).json({ detail: "Open this visual in Drive." });
        if (Number(response.headers.get("content-length")) > 4_000_000) return res.status(413).json({ detail: "Open the large image in Drive." });
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 4_000_000) return res.status(413).json({ detail: "Open the large image in Drive." });
        res.setHeader("Content-Type", type);
        res.setHeader("X-Content-Type-Options", "nosniff");
        return res.status(200).send(bytes);
      }
      if (req.query?.connection === "true") {
        try {
          const channels = await connectedVoholabsChannels();
          const scheduled = await db.query(`SELECT id, external_post_id, scheduled_at FROM valuation_hallucination.social_campaign_posts
            WHERE status='scheduled' AND external_post_id IS NOT NULL ORDER BY id DESC LIMIT 20`);
          const posts = await Promise.all(scheduled.rows.map(async post => ({ local_id: post.id,
            ...await getVoholabsPostStatus(post.external_post_id, post.scheduled_at) })));
          return res.status(200).json({ channels, posts });
        }
        catch (error) { return res.status(503).json({ detail: error.message }); }
      }
      let driveError = "";
      if (process.env.SOCIAL_DRIVE_SERVICE_ACCOUNT_JSON && Date.now() - lastDriveSync > 5 * 60 * 1000) {
        lastDriveSync = Date.now();
        try { await syncSocialDriveAssets(db); }
        catch (error) { driveError = error.message; console.error("social_drive_sync_error", error.message); }
      }
      const rows = await db.query(`SELECT id, campaign_day::text, channel, theme, caption, asset_brief, asset_url, media_url,
        destination_url, scheduled_at, status, producer, source_url, rationale, external_post_id, error_message, approved_at, archived_at, updated_at
        FROM valuation_hallucination.social_campaign_posts ORDER BY campaign_day DESC, id DESC LIMIT 120`);
      const performance = await db.query(`SELECT content,
        count(*) FILTER (WHERE event_name='social_click')::int AS clicks,
        count(*) FILTER (WHERE event_name='waitlist_signup')::int AS signups
        FROM valuation_hallucination.growth_events WHERE content LIKE 'social-%'
        GROUP BY content`);
      return res.status(200).json({ posts: rows.rows, performance: Object.fromEntries(performance.rows.map(row => [row.content, { clicks: row.clicks, signups: row.signups }])), posting_enabled: process.env.SOCIAL_POSTING_PROVIDER === "voholabs" && Boolean(process.env.VOHOLABS_API_KEY), voholabs_configured: Boolean(process.env.VOHOLABS_API_KEY), drive_configured: Boolean(process.env.SOCIAL_DRIVE_SERVICE_ACCOUNT_JSON), drive_error: driveError });
    }
    input = bodyOf(req);
    if (req.method === "POST") {
      if (input.action === "reconcile_removed") {
        const ids = input.ids;
        if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20 ||
            ids.some(id => !Number.isSafeInteger(id) || id < 1))
          return res.status(400).json({ detail: "Provide the confirmed removed post IDs." });
        const cleared = [];
        for (const id of [...new Set(ids)]) {
          const row = await db.query(`SELECT id,status,external_post_id,scheduled_at,error_message
            FROM valuation_hallucination.social_campaign_posts WHERE id=$1`, [id]);
          const post = row.rows[0];
          if (!post || post.status !== 'draft' || !post.external_post_id || !post.scheduled_at ||
              !post.error_message?.startsWith('Voholabs calendar has no matching post.'))
            return res.status(409).json({ detail: `Post ${id} is not a draft awaiting removed-post confirmation.`, cleared });
          const provider = await getVoholabsPostStatus(post.external_post_id, post.scheduled_at);
          if (provider.state !== 'NOT_FOUND')
            return res.status(409).json({ detail: `Post ${id} is still in Voholabs (${provider.state}).`, cleared });
          await db.query(`UPDATE valuation_hallucination.social_campaign_posts SET external_post_id=NULL,
            scheduled_at=NULL,approved_at=NULL,error_message=NULL,updated_at=NOW()
            WHERE id=$1 AND status='draft' AND external_post_id=$2`, [id, post.external_post_id]);
          cleared.push(id);
        }
        return res.status(200).json({ cleared });
      }
      if (input.action === "reset_reviews") {
        if (input.reset_all === true) {
          const sent = await db.query(`SELECT count(*)::int AS count FROM valuation_hallucination.social_campaign_posts
            WHERE external_post_id IS NOT NULL OR status IN ('scheduled','published')`);
          if (sent.rows[0].count) return res.status(409).json({ detail: 'Posts sent to Voholabs must be reconciled or cancelled there before resetting local IDs.' });
          const result = await db.query(`UPDATE valuation_hallucination.social_campaign_posts
            SET status='draft',approved_at=NULL,error_message=NULL,scheduled_at=NULL,updated_at=NOW()
            RETURNING id`);
          return res.status(200).json({ reset: result.rowCount, full_reset: true });
        }
        const external = await db.query(`SELECT id, status, external_post_id, scheduled_at FROM valuation_hallucination.social_campaign_posts
          WHERE status IN ('scheduled','published') OR external_post_id IS NOT NULL`);
        const kept = [];
        const needsReview = [];
        for (const post of external.rows) {
          if (post.status === 'published') { kept.push(post.id); continue; }
          if (post.status === 'draft' && post.external_post_id) { needsReview.push(post.id); continue; }
          if (!post.external_post_id || !post.scheduled_at || /^(pending|uncertain):/.test(post.external_post_id))
            return res.status(409).json({ detail: `Post ${post.id} has an uncertain Voholabs state. Check its calendar before resetting.` });
          const provider = await cancelQueuedVoholabsPost(post.external_post_id, post.scheduled_at);
          if (provider.published) {
            await db.query(`UPDATE valuation_hallucination.social_campaign_posts SET status='published',updated_at=NOW() WHERE id=$1`, [post.id]);
            kept.push(post.id);
          } else if (provider.missing) {
            // A missing calendar row might have been removed after publishing. Keep
            // the provider ID as a lock until its final outcome is verified.
            await db.query(`UPDATE valuation_hallucination.social_campaign_posts SET status='draft',approved_at=NULL,
              error_message='Voholabs calendar has no matching post. Confirm whether it published before scheduling again.',updated_at=NOW() WHERE id=$1`, [post.id]);
            needsReview.push(post.id);
          } else {
            await db.query(`UPDATE valuation_hallucination.social_campaign_posts SET status='draft',external_post_id=NULL,
              approved_at=NULL,error_message=NULL,scheduled_at=NULL,updated_at=NOW() WHERE id=$1`, [post.id]);
          }
        }
        const result = await db.query(`UPDATE valuation_hallucination.social_campaign_posts SET status='draft',approved_at=NULL,
          error_message=NULL,scheduled_at=NULL,updated_at=NOW() WHERE status IN ('approved','changes_requested','failed') RETURNING id`);
        return res.status(200).json({ reset: result.rowCount + external.rows.length - kept.length, published: kept, needs_review: needsReview });
      }
      if (input.action === "sync_assets") {
        const result = await syncSocialDriveAssets(db);
        return res.status(result.configured ? 200 : 503).json(result.configured ? result : { detail: "Drive sync needs a service account and folder access." });
      }
      if (input.action === "regenerate_copy") {
        const result = await regenerateExistingSocialCopy(db);
        return res.status(200).json(result);
      }
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
    if (input.action === 'archive' || input.action === 'restore') {
      if (existing.rows[0].external_post_id || ['scheduled','published'].includes(existing.rows[0].status))
        return res.status(409).json({ detail: 'Posts already sent to Voholabs cannot be archived from the review queue.' });
      await db.query(`UPDATE valuation_hallucination.social_campaign_posts
        SET archived_at=CASE WHEN $2='archive' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$1`, [id,input.action]);
      return res.status(200).json({ id, archived: input.action === 'archive' });
    }
    if (existing.rows[0].archived_at) return res.status(409).json({ detail: 'Restore this post from Archive before editing or scheduling.' });
    if (input.action === "schedule") {
      if (process.env.SOCIAL_POSTING_PROVIDER !== 'voholabs')
        return res.status(503).json({ detail: 'Posting is paused. Enable Voholabs in the posting configuration before scheduling.' });
      const post = existing.rows[0];
      if (post.status !== "approved" || post.external_post_id) return res.status(409).json({ detail: "Only an approved, unscheduled post can be sent to Voholabs." });
      if (!post.caption?.trim() || !post.scheduled_at || new Date(post.scheduled_at).getTime() < Date.now() + 5 * 60_000)
        return res.status(400).json({ detail: "Choose a posting time at least five minutes from now, save and approve again." });
      if (["instagram", "tiktok"].includes(post.channel) && !post.asset_url && !post.media_url)
        return res.status(400).json({ detail: "Attach a finished visual before scheduling." });
      // Claim the post before calling the provider so two clicks cannot create duplicates.
      const claim = await db.query(`UPDATE valuation_hallucination.social_campaign_posts SET external_post_id=$2, updated_at=NOW()
        WHERE id=$1 AND status='approved' AND external_post_id IS NULL RETURNING id`, [id, `pending:${id}`]);
      if (!claim.rowCount) return res.status(409).json({ detail: "This post is already being sent; refresh the page." });
      let providerAttempted = false;
      try {
        let media = null;
        if (post.asset_url) {
          const match = post.asset_url.match(/^https:\/\/drive\.google\.com\/file\/d\/([\w-]+)\//);
          if (!match) throw new Error("Finished Drive link is invalid.");
          const config = credentials();
          if (!config) throw new Error("Drive account is not connected.");
          const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(match[1])}?alt=media`, {
            headers: { Authorization: `Bearer ${await driveToken(config)}` }, signal: AbortSignal.timeout(20000)
          });
          if (!response.ok) throw new Error(`Could not read finished asset from Drive (${response.status}).`);
          const mime = response.headers.get("content-type")?.split(";")[0];
          const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4" }[mime];
          if (!extension) throw new Error("Voholabs needs a PNG, JPEG, WebP or MP4 asset.");
          if (Number(response.headers.get("content-length")) > 25_000_000) throw new Error("Asset is over the 25 MB transfer limit.");
          const bytes = await response.arrayBuffer();
          if (bytes.byteLength > 25_000_000) throw new Error("Asset is over the 25 MB transfer limit.");
          media = await uploadVoholabsMedia(bytes, mime, `vh-${id}.${extension}`);
        } else if (post.media_url) {
          throw new Error("Attach the finished Drive file to send media to Voholabs.");
        }
        providerAttempted = true;
        const externalId = await scheduleVoholabsPost(post, media);
        await db.query(`UPDATE valuation_hallucination.social_campaign_posts SET status='scheduled',external_post_id=$2,error_message=NULL,updated_at=NOW() WHERE id=$1`, [id, externalId]);
        return res.status(200).json({ id, status: "scheduled", external_post_id: externalId });
      } catch (error) {
        // Once a provider request starts, a network failure may mean it accepted the post.
        // Keep the claim to prevent duplicate scheduling until the calendar is checked.
        await db.query(`UPDATE valuation_hallucination.social_campaign_posts SET external_post_id=$2,error_message=$3,updated_at=NOW() WHERE id=$1`,
          [id, providerAttempted ? `uncertain:${id}` : null, error.message.slice(0, 500)]);
        return res.status(502).json({ detail: providerAttempted ? `${error.message} Check Voholabs calendar before retrying.` : error.message });
      }
    }
    if (existing.rows[0].external_post_id) return res.status(409).json({ detail: "This post has already been sent or is awaiting verification. Check Voholabs before editing or approving it again." });
    if (!editable.has(existing.rows[0].status)) return res.status(409).json({ detail: "Scheduled posts cannot be edited here." });
    if (input.action === "review") {
      const status = input.status;
      if (!["approved", "changes_requested", "draft"].includes(status)) return res.status(400).json({ detail: "Invalid review decision." });
      if (status === "approved" && !existing.rows[0].caption.trim()) {
        return res.status(400).json({ detail: "Add copy before approval." });
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
    if (/^Google Drive listing returned/.test(error.message)) return res.status(503).json({ detail: error.message });
    if (/^(Choose|Media needs|Use a Google Drive)/.test(error.message)) return res.status(400).json({ detail: error.message });
    console.error("growth_social_error", error.message);
    if (["generate","regenerate_copy"].includes(input?.action) && /^(AI |News scout|Writer |Editorial check|The operation was aborted)/.test(error.message)) {
      return res.status(422).json({ detail: error.message });
    }
    return res.status(500).json({ detail: "Could not update social campaigns." });
  }
}
