import { overrideFromSlack } from "../../lib/market-events.js";
import { readRawBody, verifySlack } from "../../lib/slack.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ detail: "Method not allowed." });
  }

  const body = await readRawBody(req);
  const valid = verifySlack(
    body,
    req.headers["x-slack-request-timestamp"],
    req.headers["x-slack-signature"],
    process.env.SLACK_SIGNING_SECRET
  );
  if (!valid) return res.status(401).json({ detail: "Invalid Slack signature." });

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return res.status(400).json({ detail: "Invalid JSON." });
  }

  if (payload.type === "url_verification") return res.status(200).json({ challenge: payload.challenge });
  const event = payload.event;
  if (
    !event ||
    event.type !== "message" ||
    event.bot_id ||
    !event.thread_ts ||
    (process.env.VH_SLACK_CHANNEL_ID && event.channel !== process.env.VH_SLACK_CHANNEL_ID)
  ) return res.status(200).json({ ok: true });

  const match = String(event.text || "").trim().match(/^pick\s+([123])\b/i);
  if (!match) return res.status(200).json({ ok: true });
  const changed = await overrideFromSlack(event.thread_ts, Number(match[1]) - 1);
  return res.status(200).json({ ok: true, overridden: changed });
}
