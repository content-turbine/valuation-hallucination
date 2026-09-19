import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
let pool;
let initialized = false;
let refreshPromise;

const effects = {
  AI_BOOM: {
    title: "AI BOOM",
    effect: "All Agent Cards are worth double while this card is on the board.",
    polarity: "positive",
    signal: "AGENT ×2",
    target: "Agent Cards",
    keywords: ["artificial intelligence", " ai ", "chip", "model", "openai", "anthropic"]
  },
  MARKET_CRASH: {
    title: "MARKET CRASH",
    effect: "Every company loses $100M. Company valuations cannot fall below $0.",
    polarity: "negative",
    signal: "−$100M",
    target: "Every Company",
    keywords: ["crash", "recession", "collapse", "selloff", "plunge"]
  },
  LOW_BUDGET: {
    title: "LOW BUDGET",
    effect: "Every player may keep a maximum of three Agent Cards. Choose wisely.",
    polarity: "conditional",
    signal: "MAX 3",
    target: "Agent Limit",
    keywords: ["cuts", "cut spending", "austerity", "budget", "cost cutting"]
  },
  JOB_MARKET_CRASH: {
    title: "JOB MARKET CRASH",
    effect: "Human Agent Cards cannot be added while this card is on the board.",
    polarity: "conditional",
    signal: "NO HIRES",
    target: "Human Agents",
    keywords: ["layoff", "job cuts", "unemployment", "hiring freeze"]
  },
  SPYING_INTELLIGENCE: {
    title: "SPYING INTELLIGENCE",
    effect: "AI Agent Cards are worth $0 while this card is on the board.",
    polarity: "negative",
    signal: "$0 AI",
    target: "AI Agents",
    keywords: ["data leak", "cyber", "privacy", "spy", "security breach"]
  },
  HYPE_TRAIN: {
    title: "HYPE TRAIN",
    effect: "Every player immediately gains $100M in valuation.",
    polarity: "positive",
    signal: "+$100M",
    target: "Every Company",
    keywords: ["surge", "rally", "record high", "boom", "viral"]
  },
  VC_FRENZY: {
    title: "VC FRENZY",
    effect: "Every Capital Card is worth an additional $50M while this card is on the board.",
    polarity: "positive",
    signal: "+$50M",
    target: "Per Capital Card",
    keywords: ["venture capital", "funding", "fundraise", "investment", "valuation"]
  },
  BEAR_MARKET: {
    title: "BEAR MARKET",
    effect: "Every Capital Card is worth $50M less while this card is on the board.",
    polarity: "negative",
    signal: "−$50M",
    target: "Per Capital Card",
    keywords: ["stocks fall", "shares fall", "downturn", "bear market", "slump"]
  },
  TALENT_WAR: {
    title: "TALENT WAR",
    effect: "Every Human Agent Card is worth an additional $100M while this card is on the board.",
    polarity: "positive",
    signal: "+$100M",
    target: "Per Human Agent",
    keywords: ["talent", "hiring", "recruit", "salary", "engineers"]
  },
  OPEN_BOOKS: {
    title: "OPEN BOOKS",
    effect: "AI Agents are worth $0 until their owner has at least one Human Agent.",
    polarity: "conditional",
    signal: "PROVE IT",
    target: "AI Agents",
    keywords: ["regulation", "antitrust", "disclosure", "audit", "transparency"]
  }
};

const fallback = {
  id: "v3-hype-train",
  effect_code: "HYPE_TRAIN",
  title: effects.HYPE_TRAIN.title,
  real_world_hook: "The live market feed is between signals. Use this standard Market Event.",
  polarity: effects.HYPE_TRAIN.polarity,
  signal: effects.HYPE_TRAIN.signal,
  target: effects.HYPE_TRAIN.target,
  effect: effects.HYPE_TRAIN.effect,
  source_name: "",
  source_url: "",
  published_at: null
};

const blockedTerms = ["war", "killed", "dead", "attack", "earthquake", "flood", "hostage", "shooting"];
const feedUrl = "https://api.gdeltproject.org/api/v2/doc/doc?query=(artificial%20intelligence%20OR%20startup%20OR%20venture%20capital%20OR%20stock%20market%20OR%20technology)&mode=ArtList&maxrecords=50&format=json&sort=HybridRel";
const refreshMs = 6 * 60 * 60 * 1000;

async function database() {
  if (!connectionString) return null;
  if (!pool) pool = new Pool({ connectionString, max: 1, idleTimeoutMillis: 10000 });
  if (!initialized) {
    await pool.query(`
      CREATE SCHEMA IF NOT EXISTS valuation_hallucination;
      CREATE TABLE IF NOT EXISTS valuation_hallucination.market_event_runs (
        id TEXT PRIMARY KEY,
        generated_at TIMESTAMPTZ NOT NULL,
        candidates_json JSONB NOT NULL,
        selected_index INTEGER NOT NULL DEFAULT 0,
        selection_method TEXT NOT NULL DEFAULT 'automatic',
        slack_channel_id TEXT,
        slack_thread_ts TEXT
      );
      CREATE INDEX IF NOT EXISTS market_event_runs_generated_at_idx
        ON valuation_hallucination.market_event_runs (generated_at DESC);
      CREATE INDEX IF NOT EXISTS market_event_runs_slack_thread_idx
        ON valuation_hallucination.market_event_runs (slack_thread_ts)
        WHERE slack_thread_ts IS NOT NULL;
    `);
    initialized = true;
  }
  return pool;
}

function chooseEffect(title, used) {
  const haystack = ` ${title.toLowerCase()} `;
  let best = null;
  for (const [code, config] of Object.entries(effects)) {
    if (used.has(code)) continue;
    const score = config.keywords.reduce((sum, keyword) => sum + (haystack.includes(keyword) ? 1 : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { code, score };
  }
  return best?.code || null;
}

function toCandidate(article, code) {
  const config = effects[code];
  return {
    id: crypto.randomUUID(),
    effect_code: code,
    title: config.title,
    real_world_hook: String(article.title || "A fresh market signal just landed").replace(/\s+/g, " ").trim(),
    polarity: config.polarity,
    signal: config.signal,
    target: config.target,
    effect: config.effect,
    source_name: String(article.domain || "Market source").replace(/^www\./, ""),
    source_url: String(article.url || ""),
    published_at: article.seendate || null
  };
}

async function fetchCandidates() {
  const response = await fetch(feedUrl, {
    headers: { Accept: "application/json", "User-Agent": "ValuationHallucination/1.0" },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Market feed returned ${response.status}`);
  const payload = await response.json();
  const used = new Set();
  const candidates = [];
  for (const article of payload.articles || []) {
    const headline = String(article.title || "");
    const lower = headline.toLowerCase();
    if (!headline || !article.url || (article.language && article.language !== "English") || blockedTerms.some((term) => lower.includes(term))) continue;
    const code = chooseEffect(headline, used);
    if (!code) continue;
    used.add(code);
    candidates.push(toCandidate(article, code));
    if (candidates.length === 3) break;
  }
  if (!candidates.length) throw new Error("No safe market candidates were found");
  return candidates;
}

function fromRow(row) {
  const source = typeof row.candidates_json === "string" ? JSON.parse(row.candidates_json) : row.candidates_json;
  const candidates = source.map((candidate) => {
    const config = effects[candidate.effect_code] || effects.HYPE_TRAIN;
    return { ...candidate, title: config.title, polarity: config.polarity, signal: config.signal, target: config.target, effect: config.effect };
  });
  const selectedIndex = Math.max(0, Math.min(Number(row.selected_index), candidates.length - 1));
  return {
    id: String(row.id),
    generated_at: new Date(row.generated_at).toISOString(),
    candidates,
    selected_index: selectedIndex,
    selection_method: row.selection_method === "slack_override" ? "slack_override" : "automatic",
    slack_channel_id: row.slack_channel_id ? String(row.slack_channel_id) : null,
    slack_thread_ts: row.slack_thread_ts ? String(row.slack_thread_ts) : null
  };
}

export async function getLatestRun() {
  const db = await database();
  if (!db) return null;
  const result = await db.query(`
    SELECT id, generated_at, candidates_json, selected_index, selection_method, slack_channel_id, slack_thread_ts
    FROM valuation_hallucination.market_event_runs
    ORDER BY generated_at DESC
    LIMIT 1
  `);
  return result.rowCount ? fromRow(result.rows[0]) : null;
}

function needsRefresh(run) {
  return !run || Date.now() - Date.parse(run.generated_at) >= refreshMs;
}

async function attachSlackThread(run) {
  if (!process.env.SLACK_BOT_TOKEN || !process.env.VH_SLACK_CHANNEL_ID) return;
  const blocks = run.candidates.map((candidate, index) => (
    `${index + 1}. *${candidate.title}* — ${candidate.real_world_hook}\n*${candidate.signal}* · _${candidate.effect}_\n${candidate.source_url ? `<${candidate.source_url}|${candidate.source_name}>` : candidate.source_name}`
  )).join("\n\n");
  try {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: process.env.VH_SLACK_CHANNEL_ID,
        text: `Live Market candidates\n\n${blocks}\n\nAuto-picked 1. Reply in this thread with \`pick 2\` or \`pick 3\` to override.`
      })
    });
    const result = await response.json();
    if (!result.ok || !result.ts) throw new Error(result.error || "Slack rejected the message");
    const db = await database();
    await db.query(
      `UPDATE valuation_hallucination.market_event_runs SET slack_channel_id = $1, slack_thread_ts = $2 WHERE id = $3`,
      [process.env.VH_SLACK_CHANNEL_ID, result.ts, run.id]
    );
    run.slack_channel_id = process.env.VH_SLACK_CHANNEL_ID;
    run.slack_thread_ts = result.ts;
  } catch (error) {
    console.error("market_slack_post_error", error.message);
  }
}

export async function generateRun() {
  const db = await database();
  if (!db) throw new Error("Market database is not configured");
  const candidates = await fetchCandidates();
  const run = {
    id: crypto.randomUUID(),
    generated_at: new Date().toISOString(),
    candidates,
    selected_index: 0,
    selection_method: "automatic",
    slack_channel_id: null,
    slack_thread_ts: null
  };
  await db.query(
    `INSERT INTO valuation_hallucination.market_event_runs
      (id, generated_at, candidates_json, selected_index, selection_method)
     VALUES ($1, $2, $3::jsonb, 0, 'automatic')`,
    [run.id, run.generated_at, JSON.stringify(candidates)]
  );
  await attachSlackThread(run);
  return run;
}

export async function ensureCurrent() {
  const latest = await getLatestRun();
  if (!needsRefresh(latest)) return latest;
  try {
    return await generateRun();
  } catch (error) {
    console.error("market_event_refresh_error", error.message);
    return latest;
  }
}

export function refreshInBackground(latest) {
  if (!needsRefresh(latest)) return null;
  if (!refreshPromise) {
    refreshPromise = generateRun()
      .catch((error) => {
        console.error("market_event_background_refresh_error", error.message);
        return latest;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export async function overrideFromSlack(threadTs, selectedIndex) {
  const db = await database();
  if (!db) return false;
  const result = await db.query(
    `SELECT id, generated_at, candidates_json, selected_index, selection_method, slack_channel_id, slack_thread_ts
     FROM valuation_hallucination.market_event_runs
     WHERE slack_thread_ts = $1
     ORDER BY generated_at DESC
     LIMIT 1`,
    [threadTs]
  );
  if (!result.rowCount) return false;
  const run = fromRow(result.rows[0]);
  if (selectedIndex < 0 || selectedIndex >= run.candidates.length) return false;
  await db.query(
    `UPDATE valuation_hallucination.market_event_runs
     SET selected_index = $1, selection_method = 'slack_override'
     WHERE id = $2`,
    [selectedIndex, run.id]
  );
  return true;
}

export function publicPayload(run) {
  const event = run ? run.candidates[run.selected_index] : fallback;
  return {
    card: { ...event, description: event.real_world_hook },
    event,
    candidates: run?.candidates || [fallback],
    selected_index: run?.selected_index || 0,
    selection_method: run?.selection_method || "fallback",
    generated_at: run?.generated_at || null,
    refresh_after_seconds: refreshMs / 1000
  };
}
