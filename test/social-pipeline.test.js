import test from 'node:test';
import assert from 'node:assert/strict';
import { generateReviewedSocialDrafts, storeSocialDrafts } from '../lib/social-drafts.js';

test('scout, writer and editor hand off sourced drafts to one review queue', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.PERPLEXITY_API_KEY;
  const requests = [];
  const posts = ['instagram','tiktok','x','facebook'].map(channel => ({ channel, caption: `A joke for ${channel}`, asset_brief: 'Card game illustration' }));
  const replies = [
    { event: 'A startup launched a new hiring tool', event_date: '2026-09-26', source_url: 'https://example.com/news', angle: 'Hiring your own replacement' },
    { posts }, { approved: true, reason: 'No unsupported claims' }
  ];
  process.env.PERPLEXITY_API_KEY = 'test';
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ output_text: JSON.stringify(replies.shift()) }) };
  };
  try {
    const drafts = await generateReviewedSocialDrafts('2026-09-27');
    assert.equal(requests.length, 3);
    assert.equal(requests[0].tools[0].type, 'web_search');
    assert.match(requests[1].input, /example.com\/news/);
    assert.match(requests[2].input, /A joke for x/);
    assert.equal(drafts.length, 4);
    assert.equal(drafts[0].source_url, 'https://example.com/news');
    const writes = [];
    await storeSocialDrafts({ query: async (sql, params) => { writes.push({sql,params}); return sql.startsWith('INSERT') ? {rowCount:1,rows:[{id:writes.length}]} : {rowCount:0,rows:[]}; } }, '2026-09-27', drafts);
    assert.equal(writes.length,8);
    assert.equal(writes[1].params[6], 'https://example.com/news');
    assert.match(writes[1].sql, /America\/Toronto/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.PERPLEXITY_API_KEY;
    else process.env.PERPLEXITY_API_KEY = originalKey;
  }
});

test('editor rejection does not produce drafts', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.PERPLEXITY_API_KEY;
  const replies = [
    { event: 'A startup launched a new hiring tool', event_date: '2026-09-26', source_url: 'https://example.com/news', angle: 'Hiring' },
    { posts: ['instagram','tiktok','x','facebook'].map(channel => ({channel,caption:'Draft',asset_brief:'Sketch'})) },
    { approved: false, reason: 'Premature reveal' }
  ];
  process.env.PERPLEXITY_API_KEY = 'test';
  globalThis.fetch = async () => ({ ok:true, json:async()=>({output_text:JSON.stringify(replies.shift())}) });
  try { await assert.rejects(generateReviewedSocialDrafts('2026-09-27'), /Premature reveal/); }
  finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.PERPLEXITY_API_KEY;
    else process.env.PERPLEXITY_API_KEY = originalKey;
  }
});
