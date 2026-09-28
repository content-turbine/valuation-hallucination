export const BRIEF_FOLDER_ID = '1Pf5tCG3fC0vXc9fmvJifZlAqMwzJ8D4S';

// Import the channel text already written for these visuals, not a new news story.
export function parseSocialBrief(markdown) {
  const result = {};
  const source = markdown.match(/https:\/\/(?!www\.valuationhallucination\.com)[^\s<>]+/i)?.[0]?.replace(/[),]+$/, '') || '';
  const sections = markdown.split(/^##\s+/m).slice(1);
  for (const section of sections) {
    const channel = section.match(/^(X|Instagram|Facebook|TikTok)(?:\s|\/|$)/i)?.[1]?.toLowerCase();
    if (!channel) continue;
    const body = section.slice(section.indexOf('\n') + 1);
    const match = body.match(/\*\*(?:Proposed copy|Proposed caption|Post text|Caption):?\*\*:?\s*\n([\s\S]*?)(?=\n\s*\*\*(?:Asset|Image|Video|Reel) brief|$)/i);
    if (!match) continue;
    const caption = match[1].trim().replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)');
    if (!caption || caption.length > 5000) continue;
    result[channel] = { caption, source_url: source, asset_brief: body.match(/\*\*(?:Asset|Image|Video|Reel) brief:?\*\*:?\s*([\s\S]*)/i)?.[1]?.trim().slice(0, 2000) || '' };
  }
  return result;
}

export async function syncSocialDriveCopy(db, token) {
  const pending = await db.query(`SELECT id, campaign_day::text, channel FROM valuation_hallucination.social_campaign_posts
    WHERE producer='drive' AND status IN ('draft','changes_requested') AND external_post_id IS NULL
      AND archived_at IS NULL AND TRIM(COALESCE(caption,''))='' ORDER BY campaign_day DESC LIMIT 120`);
  if (!pending.rows.length) return 0;
  const files = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({q: `'${BRIEF_FOLDER_ID}' in parents and trashed=false`, fields: 'nextPageToken,files(id,name,modifiedTime)', pageSize: '1000'});
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error(`Visuals loaded, but source briefs could not be read (${response.status}). Share the Ideas and source briefs folder with the Drive service account.`);
    const data = await response.json();
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken && files.length < 3000);
  const cache = new Map();
  let updated = 0;
  for (const post of pending.rows) {
    const day = post.campaign_day;
    if (!cache.has(day)) {
      const file = files.filter(f => f.name === `${day}-current-event-brief.md` || f.name === `${day}-current-event-brief.txt`)
        .sort((a,b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''))[0];
      if (!file) { cache.set(day, {}); continue; }
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`, {headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(15000)});
      if (!response.ok) throw new Error(`Visuals loaded, but the ${day} source brief could not be read (${response.status}).`);
      cache.set(day, parseSocialBrief(await response.text()));
    }
    const copy = cache.get(day)[post.channel];
    if (!copy) continue;
    const saved = await db.query(`UPDATE valuation_hallucination.social_campaign_posts
      SET caption=$2, source_url=CASE WHEN COALESCE(source_url,'')='' THEN $3 ELSE source_url END,
        asset_brief=CASE WHEN COALESCE(asset_brief,'')='' THEN $4 ELSE asset_brief END, updated_at=NOW()
      WHERE id=$1 AND status IN ('draft','changes_requested') AND external_post_id IS NULL AND archived_at IS NULL
        AND TRIM(COALESCE(caption,''))='' RETURNING id`, [post.id, copy.caption, copy.source_url, copy.asset_brief]);
    updated += saved.rowCount;
  }
  return updated;
}
