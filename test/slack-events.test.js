import assert from "node:assert/strict";
import test from "node:test";
import { marketPickFromEvent } from "../api/slack/events.js";

test("accepts a top-level market pick in the configured channel", () => {
  assert.deepEqual(marketPickFromEvent({
    type: "message",
    channel: "C_MARKET",
    text: "pick 3"
  }, "C_MARKET"), {
    channelId: "C_MARKET",
    threadTs: null,
    selectedIndex: 2
  });
});

test("keeps thread replies working", () => {
  assert.deepEqual(marketPickFromEvent({
    type: "message",
    channel: "C_MARKET",
    thread_ts: "123.456",
    text: "Pick 2 please"
  }, "C_MARKET"), {
    channelId: "C_MARKET",
    threadTs: "123.456",
    selectedIndex: 1
  });
});

test("ignores bot messages and messages from other channels", () => {
  assert.equal(marketPickFromEvent({
    type: "message",
    channel: "C_MARKET",
    bot_id: "B123",
    text: "pick 1"
  }, "C_MARKET"), null);
  assert.equal(marketPickFromEvent({
    type: "message",
    channel: "C_OTHER",
    text: "pick 1"
  }, "C_MARKET"), null);
});
