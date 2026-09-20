import assert from "node:assert/strict";
import test from "node:test";
import { attributionFrom, safeEventName, safeUrl } from "../lib/growth.js";
import { nextPostRecommendation, opportunityFromSource, redditSubreddits, scheduledPostRecommendation } from "../lib/reddit-content.js";
import { parseRedditFeed, scanReddit } from "../lib/reddit-scan.js";
import eventsHandler from "../api/events.js";
import growthHandler from "../api/admin/growth.js";
import waitlistHandler from "../api/waitlist.js";

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[key] = value; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    end() { return this; }
  };
}

test("normalizes Reddit attribution without accepting oversized values", () => {
  const result = attributionFrom({
    utm_source: "Reddit",
    utm_medium: "Organic",
    utm_campaign: "prelaunch",
    utm_content: "founder-id-reveal",
    subreddit: "r/SideProject",
    referred_by: "abc123",
    landing_path: "/?utm_source=reddit"
  });
  assert.equal(result.source, "reddit");
  assert.equal(result.medium, "organic");
  assert.equal(result.subreddit, "SideProject");
  assert.equal(result.referral_code, "ABC123");
  assert.equal(result.content, "founder-id-reveal");
});

test("allows only the defined event taxonomy", () => {
  assert.equal(safeEventName("page_view"), "page_view");
  assert.equal(safeEventName("DROP TABLE waitlist"), null);
});

test("rejects non-http URLs", () => {
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("https://www.reddit.com/r/SideProject"), "https://www.reddit.com/r/SideProject");
});

test("builds an opportunity from a live Reddit source instead of a fixed plan", () => {
  const result = opportunityFromSource({
    post_id: "reddit-abc",
    subreddit: "BoardgameDesign",
    source_url: "https://www.reddit.com/r/BoardgameDesign/comments/abc/example/",
    source_title: "How do you balance take-that mechanics?",
    score: 88
  });
  assert.equal(result.id, "reddit-abc");
  assert.equal(result.linkMode, "none");
  assert.match(result.angle, /take-that mechanics/);
});

test("parses current Reddit RSS entries", () => {
  const xml = `<?xml version="1.0"?><feed><entry><content type="html">&lt;p&gt;Prototype feedback&lt;/p&gt;</content><id>t3_abc123</id><link href="https://www.reddit.com/r/SideProject/comments/abc123/example/"/><published>2026-09-20T01:18:55+00:00</published><title>Testing an AI card game</title></entry></feed>`;
  const [result] = parseRedditFeed(xml, "SideProject");
  assert.equal(result.post_id, "reddit-abc123");
  assert.equal(result.source_title, "Testing an AI card game");
  assert.match(result.source_excerpt, /Prototype feedback/);
});

test("keeps the launch communities ahead of configured Reddit additions", () => {
  const communities = redditSubreddits("Entrepreneur,IndieDev");
  assert.deepEqual(communities.slice(0, 10), [
    "SideProject", "EntrepreneurRideAlong", "BoardgameDesign", "tabletopgamedesign", "playtesters",
    "boardgames", "startups", "venturecapital", "ProgrammerHumor", "Kickstarter"
  ]);
  assert.ok(communities.indexOf("IndieDev") > communities.indexOf("Kickstarter"));
});

test("requests priority Reddit communities before optional additions", async () => {
  const previous = process.env.REDDIT_SUBREDDITS;
  process.env.REDDIT_SUBREDDITS = "IndieDev";
  const calls = [];
  const feed = (subreddit) => `<?xml version="1.0"?><feed><entry><content type="html">&lt;p&gt;Current discussion&lt;/p&gt;</content><id>t3_${subreddit.toLowerCase()}</id><link href="https://www.reddit.com/r/${subreddit}/comments/${subreddit.toLowerCase()}/example/"/><published>2026-09-20T01:18:55+00:00</published><title>${subreddit} discussion</title></entry></feed>`;
  try {
    await scanReddit(async (url) => {
      const subreddit = decodeURIComponent(url.match(/\/r\/([^/]+)\/new/)?.[1] || "");
      calls.push(subreddit);
      return { ok: true, text: async () => feed(subreddit) };
    });
  } finally {
    if (previous === undefined) delete process.env.REDDIT_SUBREDDITS;
    else process.env.REDDIT_SUBREDDITS = previous;
  }
  assert.deepEqual(calls.slice(0, 10), [
    "SideProject", "EntrepreneurRideAlong", "BoardgameDesign", "tabletopgamedesign", "playtesters",
    "boardgames", "startups", "venturecapital", "ProgrammerHumor", "Kickstarter"
  ]);
  assert.ok(calls.indexOf("IndieDev") > calls.indexOf("Kickstarter"));
});

test("next post recommendation uses measured performance", () => {
  const queue = [{ id: "reddit-abc", subreddit: "SideProject", status: "planned", title: "Live topic" }];
  const result = nextPostRecommendation([{ subreddit: "SideProject", content: "origin", signups: 4 }], queue);
  assert.match(result.reason, /SideProject/);
  assert.ok(result.title);
});

test("scheduled recommendation is deterministic for a date", () => {
  const date = new Date("2026-09-19T10:00:00Z");
  const queue = [
    { id: "one", subreddit: "SideProject", status: "planned" },
    { id: "two", subreddit: "startups", status: "draft" }
  ];
  assert.deepEqual(scheduledPostRecommendation([], date, queue), scheduledPostRecommendation([], date, queue));
});

test("client event endpoint rejects server-only conversion events", async () => {
  const res = response();
  await eventsHandler({ method: "POST", body: { event_name: "waitlist_signup" } }, res);
  assert.equal(res.statusCode, 400);
});

test("growth reporting requires an admin token", async () => {
  const res = response();
  await growthHandler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 401);
});

test("waitlist rejects malformed JSON", async () => {
  const res = response();
  await waitlistHandler({ method: "POST", body: "{" }, res);
  assert.equal(res.statusCode, 400);
});
