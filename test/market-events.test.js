import assert from "node:assert/strict";
import test from "node:test";
import { candidatesFromArticles, easternDateKey, isEasternMarketTime, parseGoogleNews } from "../lib/market-events.js";

test("Eastern date keys follow Toronto time", () => {
  assert.equal(easternDateKey(new Date("2026-09-20T03:30:00Z")), "2026-09-19");
  assert.equal(easternDateKey(new Date("2026-09-20T13:30:00Z")), "2026-09-20");
});

test("9:30 Eastern gate handles daylight and standard time", () => {
  assert.equal(isEasternMarketTime(new Date("2026-09-20T13:29:00Z")), false);
  assert.equal(isEasternMarketTime(new Date("2026-09-20T13:30:00Z")), true);
  assert.equal(isEasternMarketTime(new Date("2026-12-15T14:29:00Z")), false);
  assert.equal(isEasternMarketTime(new Date("2026-12-15T14:30:00Z")), true);
});

test("Google News RSS is normalized", () => {
  const articles = parseGoogleNews(`
    <rss><channel><item>
      <title><![CDATA[Startup raises $50M for AI agents - Example News]]></title>
      <link>https://news.google.com/example?a=1&amp;b=2</link>
      <pubDate>Sun, 20 Sep 2026 12:00:00 GMT</pubDate>
      <source url="https://example.com">Example News</source>
    </item></channel></rss>
  `);
  assert.deepEqual(articles, [{
    title: "Startup raises $50M for AI agents",
    url: "https://news.google.com/example?a=1&b=2",
    domain: "Example News",
    seendate: "Sun, 20 Sep 2026 12:00:00 GMT"
  }]);
});

test("live headlines map to distinct approved card effects", () => {
  const candidates = candidatesFromArticles([
    { title: "Startup raises new venture capital funding", url: "https://example.com/funding", domain: "Example" },
    { title: "Regulator orders AI transparency audit", url: "https://example.com/audit", domain: "Example" },
    { title: "Tech company announces widespread job cuts", url: "https://example.com/jobs", domain: "Example" },
    { title: "Attack disrupts technology conference", url: "https://example.com/blocked", domain: "Example" }
  ]);
  assert.deepEqual(candidates.map((candidate) => candidate.effect_code), ["VC_FRENZY", "OPEN_BOOKS", "JOB_MARKET_CRASH"]);
  assert.equal(candidates.length, 3);
});
