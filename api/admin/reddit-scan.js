import { authorized, growthDatabase } from "../../lib/growth.js";
import { syncRedditOpportunities } from "../../lib/reddit-scan.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ detail: "Method not allowed." });
  }
  if (!authorized(req)) return res.status(401).json({ detail: "Unauthorized." });
  const db = await growthDatabase();
  if (!db) return res.status(503).json({ detail: "Growth database is not configured." });
  try {
    const scan = await syncRedditOpportunities(db);
    if (!scan.items.length) {
      return res.status(502).json({
        detail: "Reddit returned no usable feed items.",
        communities: scan.communities,
        errors: scan.errors
      });
    }
    return res.status(200).json({
      ok: true,
      scanned_at: scan.scanned_at,
      communities: scan.communities,
      opportunities: scan.items.length,
      errors: scan.errors
    });
  } catch (error) {
    console.error("reddit_scan_error", error.message);
    return res.status(502).json({ detail: "Could not scan Reddit right now." });
  }
}
