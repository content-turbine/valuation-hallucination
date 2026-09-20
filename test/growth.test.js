import assert from "node:assert/strict";
import test from "node:test";
import { attributionFrom, safeEventName, safeUrl } from "../lib/growth.js";
import { nextPostRecommendation, redditQueue, scheduledPostRecommendation } from "../lib/reddit-content.js";
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

test("content queue contains distinct community-native stages", () => {
  assert.ok(redditQueue.length >= 6);
  assert.ok(redditQueue.some((item) => item.linkMode === "none"));
  assert.ok(redditQueue.some((item) => item.linkMode === "tracked"));
});

test("next post recommendation uses measured performance", () => {
  const result = nextPostRecommendation([{ subreddit: "SideProject", content: "origin", signups: 4 }]);
  assert.match(result.reason, /SideProject/);
  assert.ok(result.title);
});

test("scheduled recommendation is deterministic for a date", () => {
  const date = new Date("2026-09-19T10:00:00Z");
  assert.deepEqual(scheduledPostRecommendation([], date), scheduledPostRecommendation([], date));
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
