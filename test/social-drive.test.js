import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { assetPostId, datedAsset, syncSocialDriveAssets } from '../lib/social-drive.js';

test('Drive assets match only explicit post IDs and supported media', () => {
  assert.equal(assetPostId({name:'post-123_instagram_topic_v01.png',mimeType:'image/png'}),123);
  assert.equal(assetPostId({name:'post-45_tiktok_reel_v02.mp4',mimeType:'video/mp4'}),45);
  assert.equal(assetPostId({name:'2026-09-27_instagram_topic.png',mimeType:'image/png'}),null);
  assert.equal(assetPostId({name:'post-3_instagram_topic_v01.png',mimeType:'text/plain'}),null);
});

test('dated Drive media can open a review slot without a preexisting post ID', () => {
  assert.deepEqual(datedAsset({name:'2026-09-27_instagram_launch-joke_v01.png',mimeType:'image/png'}),
    {day:'2026-09-27',channel:'instagram',topic:'launch joke'});
  assert.equal(datedAsset({name:'2026-09-27_tiktok_reel_storyboard_v01.md',mimeType:'text/markdown'}),null);
  assert.equal(datedAsset({name:'2026-09-27_tiktok_reel.mp4',mimeType:'video/mp4'}),null);
});

test('unconfigured Drive sync never changes the draft queue', async () => {
  const original = process.env.SOCIAL_DRIVE_SERVICE_ACCOUNT_JSON;
  delete process.env.SOCIAL_DRIVE_SERVICE_ACCOUNT_JSON;
  try { assert.deepEqual(await syncSocialDriveAssets({query:()=>{throw new Error('must not write');}}),{configured:false,matched:0,attached:0}); }
  finally { if (original !== undefined) process.env.SOCIAL_DRIVE_SERVICE_ACCOUNT_JSON=original; }
});

test('a finished dated visual creates a review item even without a draft', async () => {
  const previousKey = process.env.SOCIAL_DRIVE_SERVICE_ACCOUNT_JSON;
  const previousFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.SOCIAL_DRIVE_SERVICE_ACCOUNT_JSON = JSON.stringify({type:'service_account',client_email:'review@example.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})});
  globalThis.fetch = async url => ({ ok:true, json:async()=>String(url).includes('oauth2.googleapis.com')
    ? {access_token:'test'} : {files:[{id:'image-file-id',name:'2026-09-27_instagram_launch_v01.png',mimeType:'image/png',createdTime:'2026-09-27T12:00:00Z'}]} });
  const queries = [];
  const db = {query:async(sql,params)=>{queries.push({sql,params});return sql.includes('SELECT id, asset_url')?{rowCount:0,rows:[]}:{rowCount:1,rows:[{id:1}]};}};
  try {
    const result = await syncSocialDriveAssets(db);
    assert.equal(result.created,1);
    assert.equal(queries[1].params[3],'https://drive.google.com/file/d/image-file-id/view');
    assert.match(queries[1].sql,/producer, scheduled_at, submission_key/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.SOCIAL_DRIVE_SERVICE_ACCOUNT_JSON;
    else process.env.SOCIAL_DRIVE_SERVICE_ACCOUNT_JSON = previousKey;
  }
});
