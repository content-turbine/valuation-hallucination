import { generateRun, publicPayload } from "../../lib/market-events.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ detail: "Method not allowed." });
  }

  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!process.env.MARKET_ADMIN_TOKEN) return res.status(503).json({ detail: "Manual generation is not configured." });
  if (!supplied || supplied !== process.env.MARKET_ADMIN_TOKEN) return res.status(401).json({ detail: "Unauthorized." });

  try {
    return res.status(201).json(publicPayload(await generateRun()));
  } catch (error) {
    console.error("market_generate_error", error.message);
    return res.status(502).json({ detail: "A safe live-market card could not be generated." });
  }
}

