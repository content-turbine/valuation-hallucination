import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSocialBrief, syncSocialDriveCopy } from '../lib/social-drive-copy.js';

const brief = `# Brief
Source: https://example.com/news
## Instagram
**Caption:**

The **cloud** is up there.

**Image brief:** Original artwork.
## TikTok / Reel
**Proposed caption:**

Point UP.

**Asset brief:** A reel.
## Editorial check
Do not include me.
`;
test('imports channel captions without production directions or markdown emphasis', () => {
  const posts = parseSocialBrief(brief);
  assert.equal(posts.instagram.caption, 'The cloud is up there.');
  assert.equal(posts.tiktok.caption, 'Point UP.');
  assert.equal(posts.instagram.source_url, 'https://example.com/news');
  assert.equal(posts.instagram.asset_brief, 'Original artwork.');
  assert.equal(posts.facebook, undefined);
});
test('backfills only matching day and channel; guards manual edits at write time', async () => {
  const priorFetch = globalThis.fetch;
  const queries = [];
  globalThis.fetch = async url => String(url).includes('alt=media')
    ? {ok:true,text:async()=>brief}
    : {ok:true,json:async()=>({files:[{id:'brief',name:'2026-09-28-current-event-brief.md'}]})};
  const db = {query:async(sql,params)=>{
    queries.push({sql,params});
    if (!params) return {rows:[{id:1,campaign_day:'2026-09-28',channel:'instagram'},{id:2,campaign_day:'2026-09-27',channel:'instagram'},{id:3,campaign_day:'2026-09-28',channel:'facebook'}]};
    return {rowCount:1};
  }};
  try {
    assert.equal(await syncSocialDriveCopy(db,'test'),1);
    assert.equal(queries.length,2);
    assert.equal(queries[1].params[1],'The cloud is up there.');
    assert.match(queries[1].sql,/TRIM\(COALESCE\(caption,''\)\)=''/);
    assert.match(queries[1].sql,/external_post_id IS NULL/);
  } finally {globalThis.fetch=priorFetch;}
});
