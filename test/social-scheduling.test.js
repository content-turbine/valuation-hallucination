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

test('Instagram standalone account accepts the image and schedules once', async () => {
  const oldFetch=globalThis.fetch, oldKey=process.env.VOHOLABS_API_KEY;
  const requests=[];
  process.env.VOHOLABS_API_KEY='test';
  globalThis.fetch=async(url,options)=>{
    if(String(url).endsWith('/integrations')) return {ok:true,json:async()=>[{id:'ig-standalone',identifier:'instagram-standalone',disabled:false}]};
    requests.push(JSON.parse(options.body));
    return {ok:true,json:async()=>[{postId:'ig-post'}]};
  };
  try {
    assert.equal(await scheduleVoholabsPost({id:5,channel:'instagram',caption:'Approved caption',scheduled_at:'2026-09-29T16:00:00Z'},{id:'asset',path:'https://media.example/image.png'}),'ig-post');
    assert.equal(requests.length,1);
    assert.equal(requests[0].posts[0].integration.id,'ig-standalone');
    assert.equal(requests[0].posts[0].value[0].image[0].id,'asset');
  } finally { globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.VOHOLABS_API_KEY;else process.env.VOHOLABS_API_KEY=oldKey; }
});

test('multiple Instagram accounts require an explicit choice, not a guessed destination', async()=>{
  const oldFetch=globalThis.fetch,oldKey=process.env.VOHOLABS_API_KEY;let posts=0;
  process.env.VOHOLABS_API_KEY='test';
  globalThis.fetch=async(url)=>{
    if(String(url).endsWith('/integrations'))return {ok:true,json:async()=>[{id:'one',identifier:'instagram',disabled:false},{id:'two',identifier:'instagram-standalone',disabled:false}]};
    posts++;throw new Error('Must not post');
  };
  try {await assert.rejects(scheduleVoholabsPost({channel:'instagram'}),/found 2/);assert.equal(posts,0);}
  finally {globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.VOHOLABS_API_KEY;else process.env.VOHOLABS_API_KEY=oldKey;}
});

test('caption validation rejects before sending and replaces the complete destination URL', async()=>{
  const {prepareVoholabsCaption}=await import('../lib/voholabs.js');
  assert.throws(()=>prepareVoholabsCaption({id:12,channel:'x',caption:'x'.repeat(281)}),/280 characters/);
  const caption=prepareVoholabsCaption({id:12,channel:'x',caption:'Vote: https://www.valuationhallucination.com/choose'});
  assert.equal(caption,'Vote: https://www.valuationhallucination.com/api/events?social=12');
  const {readFileSync}=await import('node:fs');
  const handler=readFileSync(new URL('../lib/social-admin.js',import.meta.url),'utf8');
  assert.ok(handler.indexOf('try { prepareVoholabsCaption(post); }') < handler.indexOf('// Claim the post'));
  assert.match(handler,/external_post_id=\('uncertain:' \|\| id::text\)/);
});
