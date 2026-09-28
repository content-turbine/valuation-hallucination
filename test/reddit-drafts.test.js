import assert from "node:assert/strict";
import test from "node:test";
import { generateRedditDraft } from "../lib/reddit-drafts.js";

test("regenerates a grounded draft from structured Perplexity responses", async () => {
  const previous = process.env.PERPLEXITY_API_KEY;
  process.env.PERPLEXITY_API_KEY = "test-key";
  const body = "How do you balance human and AI hiring when a startup has a limited budget and needs to ship? The decision keeps getting harder as deadlines move closer.";
  const requests = [];
  const fetchMock = async (url, options) => {
    if (url.includes("reddit.com")) return { ok: true, text: async () => "" };
    const request = JSON.parse(options.body);
    requests.push(request);
    const content = requests.length === 1
      ? { evidence: body.slice(0, 70), source_point: "The author asks about hiring tradeoffs.",
        tension: "Speed versus reliability", bridge: "Human and AI agents compete for startup attention.",
        fit: "strong", reason: "The game's premise matches this hiring question." }
      : { title: "Where should the next hire go?", body: Array(15).fill("Teams face a real choice between speed and reliable judgment.").join(" "), first_comment: "" };
    return { ok: true, json: async () => ({ status: "completed", output: [
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(content) }] }
    ] }) };
  };
  try {
    const draft = await generateRedditDraft({ subreddit: "SideProject", sourceTitle: body,
      sourceExcerpt: body, sourceUrl: "https://www.reddit.com/r/SideProject/comments/abc/example/",
      cta: "Ask a useful question", linkMode: "none" }, "", fetchMock);
    assert.match(draft.title, /next hire/);
    assert.deepEqual(requests.map(item => item.response_format.json_schema.name), ["reddit_analysis", "reddit_draft"]);
    assert.ok(requests.every(item => item.max_output_tokens >= 1500));
  } finally {
    if (previous === undefined) delete process.env.PERPLEXITY_API_KEY;
    else process.env.PERPLEXITY_API_KEY = previous;
  }
});

for (const reason of ["max_output_tokens", undefined]) {
  test(`automatically retries incomplete analysis (${reason || "unspecified"}) with a larger budget`, async () => {
    const previous = process.env.PERPLEXITY_API_KEY;
    process.env.PERPLEXITY_API_KEY = "test-key";
    const source = "How do you balance human and AI hiring when a startup has a limited budget and needs to ship? The decision gets harder as deadlines move closer.";
    const requests = [];
    try {
      const result = await generateRedditDraft({sourceTitle:source,sourceExcerpt:source,subreddit:"SideProject",linkMode:"none"}, "", async (_, options) => {
        const request = JSON.parse(options.body); requests.push(request);
        if (requests.length === 1) return {ok:true,json:async()=>({status:"incomplete",incomplete_details:{reason},output_text:'{"evidence":'})};
        const data = request.response_format.json_schema.name === "reddit_analysis"
          ? {evidence:source.slice(0,70),source_point:"Hiring tradeoffs",tension:"Speed or reliability",bridge:"Hiring agents",fit:"strong",reason:"Relevant"}
          : {title:"Who should you hire?",body:Array(15).fill("Teams face a real choice between speed and reliable judgment.").join(" "),first_comment:""};
        return {ok:true,json:async()=>({status:"completed",output_text:JSON.stringify(data)})};
      });
      assert.equal(requests.length,3);
      assert.ok(requests[1].max_output_tokens > requests[0].max_output_tokens);
      assert.equal(result.title,"Who should you hire?");
    } finally {
      if(previous===undefined)delete process.env.PERPLEXITY_API_KEY;else process.env.PERPLEXITY_API_KEY=previous;
    }
  });
}

test("stops after one retry and never accepts truncated JSON", async () => {
  const previous=process.env.PERPLEXITY_API_KEY;process.env.PERPLEXITY_API_KEY="test-key";
  let calls=0;
  try {
    await assert.rejects(generateRedditDraft({sourceExcerpt:"A sufficiently detailed discussion about startup hiring choices and the challenge of balancing human judgment with AI automation in a small team."},"",async()=>{
      calls++;return {ok:true,json:async()=>({status:"incomplete",incomplete_details:{reason:"max_output_tokens"},output_text:'{"fit":"strong"}'})};
    }),/No draft was saved/);
    assert.equal(calls,2);
  } finally {if(previous===undefined)delete process.env.PERPLEXITY_API_KEY;else process.env.PERPLEXITY_API_KEY=previous;}
});
