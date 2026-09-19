import { waitUntil } from "@vercel/functions";
import { getLatestRun, publicPayload, refreshInBackground } from "../lib/market-events.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ detail: "Method not allowed." });
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  try {
    const latest = await getLatestRun();
    const refresh = refreshInBackground(latest);
    if (refresh) waitUntil(refresh);
    return res.status(200).json(publicPayload(latest));
  } catch (error) {
    console.error("market_current_error", error.message);
    return res.status(200).json(publicPayload(null));
  }
}
