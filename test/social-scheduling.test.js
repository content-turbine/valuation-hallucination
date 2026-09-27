import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleVoholabsPost } from '../lib/voholabs.js';
import clickHandler from '../api/events.js';

test('Voholabs X schedule carries a post-specific attribution link', async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.VOHOLABS_API_KEY;
  let body;
  process.env.VOHOLABS_API_KEY = 'test';
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/integrations')) return { ok:true, json:async()=>[{ id:'connected-x',identifier:'x',disabled:false }] };
    body = JSON.parse(options.body);
    return { ok:true, json:async()=>[{ postId:'provider-post-1' }] };
  };
  try {
    const id = await scheduleVoholabsPost({ id:3,channel:'x', caption:'Startups are weird. Visit valuationhallucination.com',scheduled_at:'2026-09-29T16:00:00Z' });
    assert.equal(id,'provider-post-1');
    assert.equal(body.type,'schedule');
    assert.match(body.posts[0].value[0].content,/api\/events\?social=3/);
    assert.doesNotMatch(body.posts[0].value[0].content,/Visit valuationhallucination\.com/);
  } finally {
    globalThis.fetch=oldFetch;
    if(oldKey===undefined) delete process.env.VOHOLABS_API_KEY; else process.env.VOHOLABS_API_KEY=oldKey;
  }
});

test('tracking redirect rejects malformed post ID', async () => {
  const req={method:'GET',query:{id:'3'}};
  const calls=[];
  const res={setHeader(){return this},status(n){calls.push(n);return this},end(){return this},redirect(n,url){calls.push([n,url]);return this}};
  // The endpoint uses the configured production database; exercise invalid input before a query.
  await clickHandler({method:'GET',query:{social:'bad'}},res);
  assert.deepEqual(calls,[400]);
});
