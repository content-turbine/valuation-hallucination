import { overrideFromSlack } from "../../lib/market-events.js";
import { readRawBody, verifySlack } from "../../lib/slack.js";

export const config = { api: { bodyParser: false } };

export function parseMarketPickCommand(body, expectedChannelId) {
  const params = new URLSearchParams(String(body || ""));
  const channelId = params.get("channel_id") || "";
  if (expectedChannelId && channelId !== expectedChannelId) {
    return { error: "Use this command in #valuation-hallucination-market." };
  }
  const match = String(params.get("text") || "").trim().match(/^([123])$/);
  if (!match) return { error: "Choose a card with `/market-pick 1`, `/market-pick 2`, or `/market-pick 3`." };
  return { channelId, selectedIndex: Number(match[1]) - 1 };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ detail: "Method not allowed." });
  }

  const body = await readRawBody(req);
  if (!verifySlack(
    body,
    req.headers["x-slack-request-timestamp"],
    req.headers["x-slack-signature"],
    process.env.SLACK_SIGNING_SECRET
  )) return res.status(401).json({ detail: "Invalid Slack signature." });

  const command = parseMarketPickCommand(body, process.env.VH_SLACK_CHANNEL_ID);
  if (command.error) return res.status(200).json({ response_type: "ephemeral", text: command.error });

  try {
    const result = await overrideFromSlack(null, command.selectedIndex, command.channelId);
    if (!result) {
      return res.status(200).json({
        response_type: "ephemeral",
        text: "Today's Market Event is not available yet. Run the daily market generator first."
      });
    }
    return res.status(200).json({
      response_type: "in_channel",
      text: `✅ Today's live card is now *${result.candidate.title}* (${result.candidate.signal}). The /market screen will update automatically.`
    });
  } catch (error) {
    console.error("market_slash_command_error", error.message);
    return res.status(200).json({ response_type: "ephemeral", text: "The card could not be changed. Please try again." });
  }
}
