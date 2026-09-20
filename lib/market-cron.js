import { ensureDailyRun, easternDateKey, isEasternMarketTime, publicPayload } from "./market-events.js";

export async function marketCronHandler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ detail: "Method not allowed." });
  }
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!process.env.CRON_SECRET) return res.status(503).json({ detail: "Market cron is not configured." });
  if (supplied !== process.env.CRON_SECRET) return res.status(401).json({ detail: "Unauthorized." });

  const now = new Date();
  if (!isEasternMarketTime(now)) {
    return res.status(200).json({ ok: true, created: false, skipped: "before-09:30-et", market_date: easternDateKey(now) });
  }

  try {
    const result = await ensureDailyRun(now);
    return res.status(result.created ? 201 : 200).json({ ok: true, created: result.created, ...publicPayload(result.run) });
  } catch (error) {
    console.error("market_cron_error", error.message);
    return res.status(502).json({ detail: "Today's live Market Event could not be generated." });
  }
}
