import assert from "node:assert/strict";
import test from "node:test";
import { parseMarketPickCommand } from "../api/slack/market-pick.js";

test("parses a valid market pick slash command", () => {
  assert.deepEqual(
    parseMarketPickCommand("channel_id=C_MARKET&text=2", "C_MARKET"),
    { channelId: "C_MARKET", selectedIndex: 1 }
  );
});

test("rejects market picks from another channel", () => {
  assert.deepEqual(
    parseMarketPickCommand("channel_id=C_OTHER&text=2", "C_MARKET"),
    { error: "Use this command in #valuation-hallucination-market." }
  );
});

test("rejects invalid market pick values", () => {
  assert.match(
    parseMarketPickCommand("channel_id=C_MARKET&text=4", "C_MARKET").error,
    /market-pick 1/
  );
});
