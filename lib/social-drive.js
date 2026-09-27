import crypto from "node:crypto";

export const REVIEW_FOLDER_ID = "1P9dQSR_9i66kqSRfVQatyTtH4ylWOA9I";
const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "video/mp4", "video/quicktime", "video/webm"]);

export function assetPostId(file) {
  if (!allowedTypes.has(file.mimeType) || !/^post-([1-9]\d*)_(instagram|tiktok|x|facebook)_[\w.-]+\.(png|jpe?g|webp|mp4|mov|webm)$/i.test(file.name || "")) return null;
  const id = Number(file.name.match(/^post-([1-9]\d*)_/i)[1]);
  return Number.isSafeInteger(id) ? id : null;
}

// Creators may upload directly to Drive before a database draft exists.
// The date and channel in the filename provide a stable review slot.
export function datedAsset(file) {
  if (!allowedTypes.has(file.mimeType)) return null;
  const match = String(file.name || "").match(/^(\d{4}-\d{2}-\d{2})_(instagram|tiktok|x|facebook)_([\w.-]+)_v\d+\.(png|jpe?g|webp|mp4|mov|webm)$/i);
  if (!match || Number.isNaN(Date.parse(`${match[1]}T12:00:00Z`))) return null;
  return { day: match[1], channel: match[2].toLowerCase(), topic: match[3].replace(/[-_.]/g, " ").slice(0, 160) };
}

export function credentials() {
  const raw = process.env.SOCIAL_DRIVE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const config = JSON.parse(raw);
  if (!config.client_email || !config.private_key || config.type !== "service_account") throw new Error("Drive service account configuration is invalid.");
  return config;
}

export async function driveToken(config) {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", typ: "JWT" });
  const claim = encode({ iss: config.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const unsigned = `${header}.${claim}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(config.private_key, "base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }), signal: AbortSignal.timeout(12000) });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error("Google Drive authentication failed. Check the service account and folder access.");
  return body.access_token;
}

export async function syncSocialDriveAssets(db) {
  const config = credentials();
  if (!config) return { configured: false, matched: 0, attached: 0 };
  const token = await driveToken(config);
  const files = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ q: `'${REVIEW_FOLDER_ID}' in parents and trashed = false`, fields: "nextPageToken,files(id,name,mimeType,webViewLink,createdTime)", pageSize: "1000" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Google Drive folder listing failed (${response.status}). Check folder sharing.`);
    const body = await response.json();
    files.push(...(body.files || []));
    pageToken = body.nextPageToken || "";
  } while (pageToken && files.length < 3000);
  const recent = new Map();
  const dated = new Map();
  for (const file of files) {
    const id = assetPostId(file);
    if (id && (!recent.has(id) || (file.createdTime || "") > (recent.get(id).createdTime || ""))) recent.set(id, file);
    const asset = datedAsset(file);
    if (asset) {
      const key = `${asset.day}:${asset.channel}`;
      if (!dated.has(key) || (file.createdTime || "") > (dated.get(key).file.createdTime || "")) dated.set(key, { file, ...asset });
    }
  }
  let attached = 0;
  for (const [id, file] of recent) {
    const channel = file.name.match(/^post-\d+_(instagram|tiktok|x|facebook)_/i)[1].toLowerCase();
    const url = `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`;
    const result = await db.query(`UPDATE valuation_hallucination.social_campaign_posts SET asset_url=$3, updated_at=NOW()
      WHERE id=$1 AND channel=$2 AND status IN ('draft','changes_requested') AND COALESCE(asset_url,'')='' RETURNING id`, [id, channel, url]);
    attached += result.rowCount;
  }
  let created = 0;
  for (const { file, day, channel, topic } of dated.values()) {
    const url = `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`;
    const existing = await db.query(`SELECT id, asset_url, status FROM valuation_hallucination.social_campaign_posts
      WHERE campaign_day=$1 AND channel=$2 ORDER BY id DESC LIMIT 1`, [day, channel]);
    if (existing.rowCount) {
      const post = existing.rows[0];
      if (!post.asset_url && ["draft", "changes_requested"].includes(post.status)) {
        const result = await db.query(`UPDATE valuation_hallucination.social_campaign_posts SET asset_url=$2, updated_at=NOW()
          WHERE id=$1 AND status IN ('draft','changes_requested') AND COALESCE(asset_url,'')='' RETURNING id`, [post.id, url]);
        attached += result.rowCount;
      }
    } else {
      const result = await db.query(`INSERT INTO valuation_hallucination.social_campaign_posts
        (campaign_day, channel, theme, asset_url, producer, scheduled_at, submission_key)
        VALUES ($1,$2,$3,$4,'drive',(($1::date + interval '1 day 12 hours') AT TIME ZONE 'America/Toronto'),$5)
        ON CONFLICT (submission_key) DO NOTHING RETURNING id`, [day, channel, topic, url, `drive:${day}:${channel}`]);
      created += result.rowCount;
    }
  }
  return { configured: true, matched: recent.size + dated.size, attached, created };
}
