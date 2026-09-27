import test from 'node:test';
import assert from 'node:assert/strict';
import { assetPostId, syncSocialDriveAssets } from '../lib/social-drive.js';

test('Drive assets match only explicit post IDs and supported media', () => {
  assert.equal(assetPostId({name:'post-123_instagram_topic_v01.png',mimeType:'image/png'}),123);
  assert.equal(assetPostId({name:'post-45_tiktok_reel_v02.mp4',mimeType:'video/mp4'}),45);
  assert.equal(assetPostId({name:'2026-09-27_instagram_topic.png',mimeType:'image/png'}),null);
  assert.equal(assetPostId({name:'post-3_instagram_topic_v01.png',mimeType:'text/plain'}),null);
});

test('unconfigured Drive sync never changes the draft queue', async () => {
  const original = process.env.SOCIAL_DRIVE_SERVICE_ACCOUNT_JSON;
  delete process.env.SOCIAL_DRIVE_SERVICE_ACCOUNT_JSON;
  try { assert.deepEqual(await syncSocialDriveAssets({query:()=>{throw new Error('must not write');}}),{configured:false,matched:0,attached:0}); }
  finally { if (original !== undefined) process.env.SOCIAL_DRIVE_SERVICE_ACCOUNT_JSON=original; }
});
