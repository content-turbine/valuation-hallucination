import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
let pool;
let initialized = false;

const easternTimeZone = "America/Toronto";

export const effects = {
  AI_BOOM: {
    title: "AI BOOM",
    effect: "All Agent Cards are worth double while this card is on the board.",
    polarity: "positive",
    signal: "AGENT ×2",
    target: "Agent Cards",
    keywords: ["artificial intelligence", " ai ", "ai agent", "agentic", "chip", "model", "openai", "anthropic", "nvidia"]
  },
  MARKET_CRASH: {
    title: "MARKET CRASH",
    effect: "Every company loses $100M. Company valuations cannot fall below $0.",
    polarity: "negative",
    signal: "−$100M",
    target: "Every Company",
    keywords: ["crash", "recession", "collapse", "selloff", "plunge", "bankruptcy", "insolvent"]
  },
  LOW_BUDGET: {
    title: "LOW BUDGET",
    effect: "Every player may keep a maximum of three Agent Cards. Choose wisely.",
    polarity: "conditional",
    signal: "MAX 3",
    target: "Agent Limit",
    keywords: ["cuts", "cut spending", "austerity", "budget", "cost cutting", "cost-cutting", "efficiency drive"]
  },
  JOB_MARKET_CRASH: {
    title: "JOB MARKET CRASH",
    effect: "Human Agent Cards cannot be added while this card is on the board.",
    polarity: "conditional",
    signal: "NO HIRES",
    target: "Human Agents",
    keywords: ["layoff", "job cuts", "unemployment", "hiring freeze", "workforce reduction", "cuts jobs"]
  },
  SPYING_INTELLIGENCE: {
    title: "SPYING INTELLIGENCE",
    effect: "AI Agent Cards are worth $0 while this card is on the board.",
    polarity: "negative",
    signal: "$0 AI",
    target: "AI Agents",
    keywords: ["data leak", "cyber", "privacy", "spy", "security breach", "hack", "ransomware"]
  },
  HYPE_TRAIN: {
    title: "HYPE TRAIN",
    effect: "Every player immediately gains $100M in valuation.",
    polarity: "positive",
    signal: "+$100M",
    target: "Every Company",
    keywords: ["surge", "rally", "record high", "boom", "viral", "soars", "jumps", "breakthrough"]
  },
  VC_FRENZY: {
    title: "VC FRENZY",
    effect: "Every Capital Card is worth an additional $50M while this card is on the board.",
    polarity: "positive",
    signal: "+$50M",
    target: "Per Capital Card",
    keywords: ["venture capital", "funding", "fundraise", "investment", "valuation", "raises", "seed round", "series a", "series b"]
  },
  BEAR_MARKET: {
    title: "BEAR MARKET",
    effect: "Every Capital Card is worth $50M less while this card is on the board.",
    polarity: "negative",
    signal: "−$50M",
    target: "Per Capital Card",
    keywords: ["stocks fall", "shares fall", "downturn", "bear market", "slump", "market falls", "shares slide"]
  },
  TALENT_WAR: {
    title: "TALENT WAR",
    effect: "Every Human Agent Card is worth an additional $100M while this card is on the board.",
    polarity: "positive",
    signal: "+$100M",
    target: "Per Human Agent",
    keywords: ["talent", "hiring", "recruit", "salary", "engineers", "poaches", "compensation"]
  },
  OPEN_BOOKS: {
    title: "OPEN BOOKS",
    effect: "AI Agents are worth $0 until their owner has at least one Human Agent.",
    polarity: "conditional",
    signal: "PROVE IT",
    target: "AI Agents",
    keywords: ["regulation", "antitrust", "disclosure", "audit", "transparency", "regulator", "compliance", "investigation"]
  }
};

const fallback = {
  id: "v3-hype-train",
  effect_code: "HYPE_TRAIN",
  title: effects.HYPE_TRAIN.title,
  real_world_hook: "Today's live Market Event has not landed yet. Use this standard Market Event.",
  polarity: effects.HYPE_TRAIN.polarity,
  signal: effects.HYPE_TRAIN.signal,
  target: effects.HYPE_TRAIN.target,
  effect: effects.HYPE_TRAIN.effect,
  source_name: "",
  source_url: "",
  published_at: null
};

const blockedTerms = ["war", "killed", "dead", "attack", "earthquake", "flood", "hostage", "shooting"];
const googleNewsUrl = "https://news.google.com/rss/search?q=(artificial%20intelligence%20OR%20startup%20OR%20venture%20capital%20OR%20stock%20market%20OR%20technology)%20when%3A1d&hl=en-US&gl=US&ceid=US%3Aen";
const gdeltUrl = "https://api.gdeltproject.org/api/v2/doc/doc?query=(artificial%20intelligence%20OR%20startup%20OR%20venture%20capital%20OR%20stock%20market%20OR%20technology)&mode=ArtList&maxrecords=50&format=json&sort=HybridRel";
const hackerNewsUrl = "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=40";

async function database() {
  if (!connectionString) return null;
  if (!pool) pool = new Pool({ connectionString, max: 1, idleTimeoutMillis: 10000 });
  if (!initialized) {
    await pool.query(`
      CREATE SCHEMA IF NOT EXISTS valuation_hallucination;
      CREATE TABLE IF NOT EXISTS valuation_hallucination.market_event_runs (
        id TEXT PRIMARY KEY,
        generated_at TIMESTAMPTZ NOT NULL,
        market_date DATE,
        candidates_json JSONB NOT NULL,
        selected_index INTEGER NOT NULL DEFAULT 0,
        selection_method TEXT NOT NULL DEFAULT 'automatic',
        slack_channel_id TEXT,
        slack_thread_ts TEXT
      );
      ALTER TABLE valuation_hallucination.market_event_runs
        ADD COLUMN IF NOT EXISTS market_date DATE;
      CREATE UNIQUE INDEX IF NOT EXISTS market_event_runs_market_date_idx
        ON valuation_hallucination.market_event_runs (market_date);
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

function easternParts(now = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: easternTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

export function easternDateKey(now = new Date()) {
  const parts = easternParts(now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isEasternMarketTime(now = new Date()) {
  const parts = easternParts(now);
  return Number(parts.hour) * 60 + Number(parts.minute) >= 9 * 60 + 30;
}

function decodeXml(value) {
  return String(value || "")
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function xmlTag(block, tag) {
  const match = String(block).match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeXml(match?.[1] || "");
}

export function parseGoogleNews(xml) {
  const articles = [];
  for (const match of String(xml || "").matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const source = xmlTag(block, "source") || "Google News";
    let title = xmlTag(block, "title");
    const suffix = ` - ${source}`;
    if (title.endsWith(suffix)) title = title.slice(0, -suffix.length);
    const url = xmlTag(block, "link");
    if (title && url) articles.push({ title, url, domain: source, seendate: xmlTag(block, "pubDate") || null });
  }
  return articles;
}

async function fetchWithTimeout(url, accept) {
  const response = await fetch(url, {
    headers: { Accept: accept, "User-Agent": "ValuationHallucination/1.0 (+https://www.valuationhallucination.com)" },
    signal: AbortSignal.timeout(7000)
  });
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned ${response.status}`);
  return response;
}

async function fetchGoogleNews() {
  const response = await fetchWithTimeout(googleNewsUrl, "application/rss+xml, application/xml, text/xml");
  return parseGoogleNews(await response.text());
}

async function fetchGdelt() {
  const response = await fetchWithTimeout(gdeltUrl, "application/json");
  const payload = await response.json();
  return (payload.articles || []).map((article) => ({ title: article.title, url: article.url, domain: article.domain, seendate: article.seendate, language: article.language }));
}

async function fetchHackerNews() {
  const response = await fetchWithTimeout(hackerNewsUrl, "application/json");
  const payload = await response.json();
  return (payload.hits || []).map((article) => ({
    title: article.title,
    url: article.url || `https://news.ycombinator.com/item?id=${article.objectID}`,
    domain: article.url ? new URL(article.url).hostname.replace(/^www\./, "") : "Hacker News",
    seendate: article.created_at,
    language: "English"
  }));
}

export function chooseEffect(title, used = new Set()) {
  const haystack = ` ${String(title).toLowerCase()} `;
  let best = null;
  for (const [code, config] of Object.entries(effects)) {
    if (used.has(code)) continue;
    const score = config.keywords.reduce((sum, keyword) => (
      sum + (haystack.includes(keyword) ? 1 + keyword.trim().split(/\s+/).length / 10 : 0)
    ), 0);
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

export function candidatesFromArticles(articles) {
  const usedEffects = new Set();
  const usedHeadlines = new Set();
  const candidates = [];
  for (const article of articles) {
    const headline = String(article.title || "").replace(/\s+/g, " ").trim();
    const lower = headline.toLowerCase();
    if (!headline || !article.url || usedHeadlines.has(lower) || (article.language && article.language !== "English") || blockedTerms.some((term) => lower.includes(term))) continue;
    const code = chooseEffect(headline, usedEffects);
    if (!code) continue;
    usedHeadlines.add(lower);
    usedEffects.add(code);
    candidates.push(toCandidate(article, code));
    if (candidates.length === 3) break;
  }
  return candidates;
}

async function fetchCandidates() {
  const results = await Promise.allSettled([fetchGoogleNews(), fetchGdelt(), fetchHackerNews()]);
  const articles = [];
  for (const result of results) {
    if (result.status === "fulfilled") articles.push(...result.value);
    else console.warn("market_source_error", result.reason?.message || String(result.reason));
  }
  const candidates = candidatesFromArticles(articles);
  if (!candidates.length) throw new Error("No safe market candidates were found across live sources");
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
    market_date: row.market_date ? String(row.market_date).slice(0, 10) : null,
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
    SELECT id, generated_at, market_date, candidates_json, selected_index, selection_method, slack_channel_id, slack_thread_ts
    FROM valuation_hallucination.market_event_runs
    ORDER BY generated_at DESC
    LIMIT 1
  `);
  return result.rowCount ? fromRow(result.rows[0]) : null;
}

async function getRunForDate(marketDate) {
  const db = await database();
  if (!db) return null;
  const result = await db.query(`
    SELECT id, generated_at, market_date, candidates_json, selected_index, selection_method, slack_channel_id, slack_thread_ts
    FROM valuation_hallucination.market_event_runs
    WHERE market_date = $1::date
    LIMIT 1
  `, [marketDate]);
  return result.rowCount ? fromRow(result.rows[0]) : null;
}

async function attachSlackThread(run) {
  if (!process.env.SLACK_BOT_TOKEN || !process.env.VH_SLACK_CHANNEL_ID) throw new Error("Slack market controls are not configured");
  const blocks = run.candidates.map((candidate, index) => (
    `${index + 1}. *${candidate.title}* — ${candidate.real_world_hook}\n*${candidate.signal}* · _${candidate.effect}_\n${candidate.source_url ? `<${candidate.source_url}|${candidate.source_name}>` : candidate.source_name}`
  )).join("\n\n");
  const choices = run.candidates.map((_, index) => `\`pick ${index + 1}\``).join(", ");
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: process.env.VH_SLACK_CHANNEL_ID,
      text: `📈 *Live Market — ${run.market_date}*\n\n${blocks}\n\nAuto-picked *1*. Reply in this thread with ${choices} to override today's card.`
    })
  });
  const result = await response.json();
  if (!result.ok || !result.ts) throw new Error(result.error || "Slack rejected the market message");
  const db = await database();
  await db.query(
    `UPDATE valuation_hallucination.market_event_runs SET slack_channel_id = $1, slack_thread_ts = $2 WHERE id = $3`,
    [process.env.VH_SLACK_CHANNEL_ID, result.ts, run.id]
  );
  run.slack_channel_id = process.env.VH_SLACK_CHANNEL_ID;
  run.slack_thread_ts = result.ts;
}

export async function ensureDailyRun(now = new Date()) {
  const db = await database();
  if (!db) throw new Error("Market database is not configured");
  const marketDate = easternDateKey(now);
  const existing = await getRunForDate(marketDate);
  if (existing) {
    if (!existing.slack_thread_ts) await attachSlackThread(existing);
    return { run: existing, created: false };
  }

  const candidates = await fetchCandidates();
  const run = {
    id: crypto.randomUUID(),
    generated_at: now.toISOString(),
    market_date: marketDate,
    candidates,
    selected_index: 0,
    selection_method: "automatic",
    slack_channel_id: null,
    slack_thread_ts: null
  };
  const inserted = await db.query(
    `INSERT INTO valuation_hallucination.market_event_runs
      (id, generated_at, market_date, candidates_json, selected_index, selection_method)
     VALUES ($1, $2, $3::date, $4::jsonb, 0, 'automatic')
     ON CONFLICT (market_date) DO NOTHING
     RETURNING id`,
    [run.id, run.generated_at, marketDate, JSON.stringify(candidates)]
  );
  if (!inserted.rowCount) {
    const concurrent = await getRunForDate(marketDate);
    if (concurrent && !concurrent.slack_thread_ts) await attachSlackThread(concurrent);
    return { run: concurrent, created: false };
  }
  await attachSlackThread(run);
  return { run, created: true };
}

export async function overrideFromSlack(threadTs, selectedIndex) {
  const db = await database();
  if (!db) return null;
  const result = await db.query(
    `SELECT id, generated_at, market_date, candidates_json, selected_index, selection_method, slack_channel_id, slack_thread_ts
     FROM valuation_hallucination.market_event_runs
     WHERE slack_thread_ts = $1
     ORDER BY generated_at DESC
     LIMIT 1`,
    [threadTs]
  );
  if (!result.rowCount) return null;
  const run = fromRow(result.rows[0]);
  if (selectedIndex < 0 || selectedIndex >= run.candidates.length) return null;
  await db.query(
    `UPDATE valuation_hallucination.market_event_runs
     SET selected_index = $1, selection_method = 'slack_override'
     WHERE id = $2`,
    [selectedIndex, run.id]
  );
  return { channel_id: run.slack_channel_id, candidate: run.candidates[selectedIndex], selected_index: selectedIndex };
}

export async function acknowledgeSlackOverride(result, threadTs) {
  if (!result?.channel_id || !process.env.SLACK_BOT_TOKEN) return;
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: result.channel_id,
      thread_ts: threadTs,
      text: `✅ Today's live card is now *${result.candidate.title}* (${result.candidate.signal}). The /market screen will update automatically.`
    })
  });
  const payload = await response.json();
  if (!payload.ok) console.error("market_slack_ack_error", payload.error || "Slack rejected the confirmation");
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
    market_date: run?.market_date || null,
    refresh_after_seconds: 86400
  };
}
