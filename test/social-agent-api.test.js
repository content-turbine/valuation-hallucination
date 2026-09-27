import test from 'node:test';
import assert from 'node:assert/strict';
import socialBrief from '../lib/social-brief.js';
import socialAsset from '../lib/social-asset.js';
function response() { return { code:200, headers:{}, setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;return this;} }; }
test('agent brief and asset handoff reject requests without dedicated tokens', async () => {
  const brief=response();
  await socialBrief({method:'GET',headers:{}},brief);
  assert.equal(brief.code,401);
  const asset=response();
  await socialAsset({method:'POST',headers:{},body:{post_id:1,asset_url:'https://drive.google.com/file/d/test/view'}},asset);
  assert.equal(asset.code,401);
});
