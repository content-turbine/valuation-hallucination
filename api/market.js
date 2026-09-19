import crypto from "node:crypto";

const cards = [
  { id: 1, title: "AI BOOM", polarity: "positive", signal: "AGENT ×2", target: "Agent Cards", description: "The market has decided every workflow needs an agent.", effect: "All Agent Cards are worth double until this card leaves the table." },
  { id: 2, title: "MARKET CRASH", polarity: "negative", signal: "−$100M", target: "Every Company", description: "Growth multiples have remembered gravity.", effect: "Every company loses $100M. Company valuations cannot fall below $0." },
  { id: 3, title: "LOW BUDGET", polarity: "negative", signal: "MAX 3", target: "Agent Limit", description: "Runway is short and the board wants focus.", effect: "Every player may keep a maximum of three Agent Cards. Choose wisely." },
  { id: 4, title: "JOB MARKET CRASH", polarity: "negative", signal: "NO HIRES", target: "Human Agents", description: "The talent pipeline has frozen overnight.", effect: "Human Agent Cards cannot be added until this card leaves the table." },
  { id: 5, title: "SPYING INTELLIGENCE", polarity: "negative", signal: "$0 AI", target: "AI Agents", description: "Big companies hired spies to steal every prompt and secret.", effect: "AI Agent Cards are worth $0 while this card is active." },
  { id: 6, title: "HYPE TRAIN", polarity: "positive", signal: "+$100M", target: "Every Company", description: "AI is on every front page and nobody is checking the unit economics.", effect: "Every player immediately gains $100M in valuation." },
  { id: 7, title: "VC FRENZY", polarity: "positive", signal: "+$50M", target: "Per Capital Card", description: "Investors are throwing money at anything with a deck.", effect: "Every Capital Card is worth an additional $50M until replaced." },
  { id: 8, title: "BEAR MARKET", polarity: "negative", signal: "−$50M", target: "Per Capital Card", description: "Investors have discovered the word profitability.", effect: "Every Capital Card is worth $50M less while this card is active." },
  { id: 9, title: "TALENT WAR", polarity: "positive", signal: "+$100M", target: "Per Human Agent", description: "Big tech is buying every expert it can find.", effect: "Every Human Agent Card is worth an additional $100M while active." },
  { id: 10, title: "OPEN BOOKS", polarity: "conditional", signal: "PROVE IT", target: "AI Agents", description: "The regulator wants evidence, disclosures, and risk controls.", effect: "AI Agents are worth $0 unless their owner has at least one Human Agent." }
];

function dailyIndex() {
  const day = new Date().toISOString().slice(0, 10);
  return crypto.createHash("sha256").update(day).digest()[0] % cards.length;
}

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ detail: "Method not allowed." });
  }

  const mode = req.query?.draw === "random" ? "random" : "daily";
  const index = mode === "random" ? crypto.randomInt(cards.length) : dailyIndex();
  res.setHeader("Cache-Control", mode === "daily" ? "public, s-maxage=300, stale-while-revalidate=600" : "no-store");
  return res.status(200).json({
    mode,
    generated_at: new Date().toISOString(),
    feed: "pre-launch-market-simulator",
    card: cards[index]
  });
}
