import { attributionFrom, growthDatabase, recordEvent, safeEventName } from "../lib/growth.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ detail: "Method not allowed." });
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const eventName = safeEventName(body.event_name);
    if (!eventName || eventName === "waitlist_signup" || eventName === "referral_qualified" || eventName === "milestone_unlocked") {
      return res.status(400).json({ detail: "Unsupported client event." });
    }
    const db = await growthDatabase();
    if (!db) return res.status(202).json({ accepted: false, reason: "tracking-not-configured" });
    await recordEvent(db, eventName, attributionFrom(body), body.properties || {});
    return res.status(202).json({ accepted: true });
  } catch (error) {
    console.error("growth_event_error", error.message);
    return res.status(202).json({ accepted: false });
  }
}

