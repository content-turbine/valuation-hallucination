import {
  opportunityFromSource,
  PRIORITY_REDDIT_SUBREDDITS,
  redditStrategyTags,
  redditSubreddits
} from "./reddit-content.js";

const clean = (value, length = 2000) => String(value || "").replace(/\s+/g, " ").trim().slice(0, length);

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function textBetween(entry, tag) {
  const match = entry.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return clean(decodeXml(match?.[1] || ""));
}

function stripHtml(value) {
  return clean(decodeXml(value).replace(/<[^>]+>/g, " "), 1200);
}

function sourceId(entry, url) {
  const id = textBetween(entry, "id").replace(/^t3_/, "");
  const fromUrl = String(url).match(/\/comments\/([a-z0-9]+)\//i)?.[1];
  return clean(id || fromUrl || Buffer.from(url).toString("base64url").slice(0, 32), 80);
}

export function parseRedditFeed(xml, subreddit, feedType = "new") {
  const entries = String(xml || "").match(/<entry>[\s\S]*?<\/entry>/gi) || [];
  return entries.map((entry, index) => {
    const link = entry.match(/<link\s+href="([^"]+)"/i)?.[1] || "";
    const url = clean(decodeXml(link), 800);
    const title = textBetween(entry, "title");
    const published = textBetween(entry, "published") || textBetween(entry, "updated");
    const contentMatch = entry.match(/<content(?:\s[^>]*)?>([\s\S]*?)<\/content>/i)?.[1] || "";
    if (!url || !title || !/reddit\.com\/r\//i.test(url)) return null;
    const category = clean(decodeXml(entry.match(/<category\s+term="([^"]+)"/i)?.[1] || ""), 40);
    const resolvedSubreddit = subreddit || category || url.match(/reddit\.com\/r\/([^/]+)/i)?.[1] || "Reddit";
    const id = sourceId(entry, url);
    return {
      post_id: `reddit-${id}`,
      source_post_id: id,
      subreddit: resolvedSubreddit,
      source_url: url,
      source_title: title,
      source_excerpt: stripHtml(contentMatch),
      source_published_at: published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : null,
      feed_type: feedType,
      feed_rank: index + 1
    };
  }).filter(Boolean);
}

const contextualSignals = {
  founder: [
    "startup", "founder", "cofounder", "entrepreneur", "valuation", "fundraise", "fundraising",
    "investor", "venture capital", "term sheet", "pitch deck", "bootstrapped", "runway", "saas",
    "side project", "customer validation", "product-market fit", "mvp", "hiring", "revenue"
  ],
  ai: ["artificial intelligence", "machine learning", "chatgpt", "llm", "agentic", "ai agent", "automation"],
  game: [
    "card game", "board game", "tabletop", "playtest", "game design", "game mechanic", "rulebook",
    "prototype", "deckbuilder", "party game", "take-that"
  ],
  campaign: [
    "kickstarter", "crowdfunding", "campaign", "backer", "pledge", "pre-launch", "launch page",
    "manufacturer", "manufacturing", "fulfillment"
  ],
  satire: ["satire", "parody", "humor", "meme", "joke"]
};

function containsSignal(content, phrase) {
  if (phrase.includes(" ") || phrase.includes("-")) return content.includes(phrase);
  return new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(content);
}

function matchedSignals(content, phrases) {
  return phrases.filter((phrase) => containsSignal(content, phrase));
}

export function screenRedditOpportunity(item) {
  const content = `${item.source_title || ""} ${item.source_excerpt || ""}`.toLowerCase();
  const matches = Object.fromEntries(
    Object.entries(contextualSignals).map(([group, phrases]) => [group, matchedSignals(content, phrases)])
  );
  const subreddit = String(item.subreddit || "").toLowerCase();
  const isGameCommunity = ["boardgamedesign", "tabletopgamedesign", "playtesters", "boardgames"].includes(subreddit);
  const isKickstarter = subreddit === "kickstarter";
  const isProgrammerHumor = subreddit === "programmerhumor";
  const totalMatches = Object.values(matches).reduce((total, values) => total + values.length, 0);
  let relevant;
  let criterion;
  if (isGameCommunity) {
    relevant = matches.game.length > 0;
    criterion = "a concrete card, board-game, tabletop, or playtesting signal";
  } else if (isKickstarter) {
    relevant = matches.campaign.length > 0 && matches.game.length > 0;
    criterion = "both crowdfunding and tabletop/card-game context";
  } else if (isProgrammerHumor) {
    relevant = matches.ai.length > 0 && (matches.satire.length > 0 || matches.founder.length > 0);
    criterion = "AI/startup context with a humor or founder angle";
  } else {
    relevant = matches.founder.length > 0 || matches.ai.length > 0 || matches.game.length > 0;
    criterion = "a founder, startup, AI, or physical-game conversation hook";
  }
  const matched = Object.entries(matches)
    .filter(([, values]) => values.length)
    .map(([group, values]) => `${group}: ${values.slice(0, 3).join(", ")}`);
  const contextScore = Math.min(100, (relevant ? 45 : 0) + Math.min(40, totalMatches * 10) + (matched.length > 1 ? 15 : 0));
  return {
    relevant,
    context_score: contextScore,
    tags: redditStrategyTags(item.subreddit),
    relevance_reasons: relevant ? [`Qualified on ${criterion}`, ...matched] : [`Missing ${criterion}`]
  };
}

function relevanceScore(item, screening, now = Date.now()) {
  const ageHours = item.source_published_at
    ? Math.max(0, (now - Date.parse(item.source_published_at)) / 3600000)
    : 72;
  const freshness = Math.max(0, 25 - Math.round(ageHours / 6));
  const rank = Math.max(0, 15 - Math.round(item.feed_rank / 2));
  return Math.min(100, Math.round(screening.context_score * 0.65 + freshness + rank));
}

async function fetchFeed(subreddit, fetchImpl) {
  const response = await fetchImpl(`https://www.reddit.com/r/${encodeURIComponent(subreddit)}/new/.rss`, {
    headers: {
      Accept: "application/atom+xml, application/xml;q=0.9",
      "User-Agent": "valuationhallucination/1.0 (Reddit trend scanner; contact hello@valuationhallucination.com)"
    },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`r/${subreddit} returned ${response.status}`);
  return parseRedditFeed(await response.text(), subreddit, "new");
}

async function fetchCombinedFeed(communities, fetchImpl) {
  const multi = communities.map(encodeURIComponent).join("+");
  const response = await fetchImpl(`https://www.reddit.com/r/${multi}/new/.rss`, {
    headers: {
      Accept: "application/atom+xml, application/xml;q=0.9",
      "User-Agent": "valuationhallucination/1.0 (Reddit trend scanner; contact hello@valuationhallucination.com)"
    },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`combined Reddit feed returned ${response.status}`);
  return parseRedditFeed(await response.text(), "", "new");
}

async function fetchPerplexityFallback(communities, fetchImpl) {
  if (!process.env.PERPLEXITY_API_KEY) return [];
  const response = await fetchImpl("https://api.perplexity.ai/v1/agent", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.PERPLEXITY_SCAN_MODEL || "openai/gpt-5.6-luna",
      input: `Find current, publicly accessible Reddit discussions from the last seven days in these communities: ${communities.map((item) => `r/${item}`).join(", ")}. Prioritize startup building, fundraising, AI hype, physical card games, playtesting, crowdfunding, and Kickstarter. Use one concise web search query and return a short summary.`,
      instructions: "Use the web_search tool exactly once. Prefer direct reddit.com discussion URLs over summaries or third-party pages.",
      tools: [{ type: "web_search" }],
      max_tool_calls: 1,
      max_output_tokens: 250
    }),
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`Perplexity Reddit fallback returned ${response.status}`);
  const payload = await response.json();
  const results = (payload.output || []).flatMap((item) => item.results || []);
  return results.map((result, index) => {
    const url = clean(result.url, 800);
    const subreddit = url.match(/reddit\.com\/r\/([^/]+)/i)?.[1];
    const id = url.match(/\/comments\/([a-z0-9]+)\//i)?.[1];
    if (!url || !subreddit || !id || !communities.some((item) => item.toLowerCase() === subreddit.toLowerCase())) return null;
    const published = result.date || result.last_updated || null;
    return {
      post_id: `reddit-${id}`,
      source_post_id: id,
      subreddit,
      source_url: url,
      source_title: clean(result.title, 500),
      source_excerpt: clean(result.snippet, 1200),
      source_published_at: published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : null,
      feed_type: "perplexity-search",
      feed_rank: index + 1
    };
  }).filter((item) => item?.source_title);
}

export async function scanReddit(fetchImpl = fetch) {
  const communities = redditSubreddits();
  const errors = [];
  const unique = new Map();
  let feeds = [];
  const priorityNames = new Set(PRIORITY_REDDIT_SUBREDDITS.map((item) => item.toLowerCase()));
  const priority = communities.filter((item) => priorityNames.has(item.toLowerCase()));
  const additional = communities.filter((item) => !priorityNames.has(item.toLowerCase()));

  async function scanCommunityBatch(batch) {
    if (!batch.length) return;
    const settled = await Promise.allSettled(batch.map((subreddit) => fetchFeed(subreddit, fetchImpl)));
    const failed = [];
    settled.forEach((result, index) => {
      if (result.status === "rejected") {
        failed.push(batch[index]);
        errors.push(result.reason?.message || `r/${batch[index]} failed`);
      } else {
        feeds.push(...result.value);
      }
    });
    if (failed.length) {
      try {
        feeds.push(...await fetchCombinedFeed(failed, fetchImpl));
      } catch (error) {
        errors.push(error.message);
      }
    }
  }

  // Guarantee the launch strategy communities are requested before optional configured extras.
  await scanCommunityBatch(priority);
  await scanCommunityBatch(additional);
  let screenedFeeds = feeds.map((item) => ({ ...item, ...screenRedditOpportunity(item) }));
  if (screenedFeeds.filter((item) => item.relevant).length < 5 && process.env.PERPLEXITY_API_KEY) {
    try {
      const fallback = await fetchPerplexityFallback(communities, fetchImpl);
      feeds.push(...fallback);
      screenedFeeds.push(...fallback.map((item) => ({ ...item, ...screenRedditOpportunity(item) })));
    } catch (error) {
      errors.push(error.message);
    }
  }
  screenedFeeds.filter((item) => item.relevant).forEach((item) => {
    const scored = { ...item, score: relevanceScore(item, item) };
    if (!unique.has(item.source_url) || unique.get(item.source_url).score < scored.score) unique.set(item.source_url, scored);
  });
  return {
    communities,
    errors,
    screened_out: screenedFeeds.filter((item) => !item.relevant).length,
    items: [...unique.values()]
      .sort((a, b) => b.score - a.score || Date.parse(b.source_published_at || 0) - Date.parse(a.source_published_at || 0))
      .slice(0, 60)
  };
}

export async function syncRedditOpportunities(db, fetchImpl = fetch) {
  const scan = await scanReddit(fetchImpl);
  for (const item of scan.items) {
    const opportunity = opportunityFromSource(item);
    await db.query(
      `INSERT INTO valuation_hallucination.reddit_opportunities
        (post_id, source_post_id, subreddit, source_url, source_title, source_excerpt,
         source_published_at, feed_type, score, phase, angle, cta, link_mode, tags,
         context_score, relevance_reasons, context_relevant, discovered_at, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16::jsonb,TRUE,NOW(),NOW())
       ON CONFLICT (post_id) DO UPDATE SET
         source_title = EXCLUDED.source_title,
         source_excerpt = EXCLUDED.source_excerpt,
         source_published_at = EXCLUDED.source_published_at,
         feed_type = EXCLUDED.feed_type,
         score = EXCLUDED.score,
         phase = EXCLUDED.phase,
         angle = EXCLUDED.angle,
         cta = EXCLUDED.cta,
         link_mode = EXCLUDED.link_mode,
         tags = EXCLUDED.tags,
         context_score = EXCLUDED.context_score,
         relevance_reasons = EXCLUDED.relevance_reasons,
         context_relevant = TRUE,
         last_seen_at = NOW()`,
      [item.post_id, item.source_post_id, item.subreddit, item.source_url, item.source_title,
        item.source_excerpt || null, item.source_published_at, item.feed_type, item.score,
        opportunity.phase, opportunity.angle, opportunity.cta, opportunity.linkMode,
        JSON.stringify(item.tags), item.context_score, JSON.stringify(item.relevance_reasons)]
    );
  }
  return { ...scan, scanned_at: new Date().toISOString() };
}

export function opportunityRowToPost(row) {
  const screening = screenRedditOpportunity(row);
  return {
    id: row.post_id,
    subreddit: row.subreddit,
    phase: row.phase,
    title: `Current discussion: ${row.source_title}`,
    angle: row.angle,
    cta: row.cta,
    linkMode: row.link_mode,
    status: row.status || "planned",
    sourceUrl: row.source_url,
    sourceTitle: row.source_title,
    sourceExcerpt: row.source_excerpt || "",
    sourcePublishedAt: row.source_published_at,
    discoveredAt: row.discovered_at,
    lastSeenAt: row.last_seen_at,
    score: Number(row.score || 0),
    tags: Array.isArray(row.tags) && row.tags.length ? row.tags : screening.tags,
    contextScore: Number(row.context_score || screening.context_score || 0),
    relevanceReasons: Array.isArray(row.relevance_reasons) && row.relevance_reasons.length
      ? row.relevance_reasons
      : screening.relevance_reasons,
    reddit_url: row.reddit_url || "",
    draft_title: row.draft_title || "",
    draft_body: row.draft_body || "",
    first_comment: row.first_comment || "",
    llm_model: row.llm_model || "",
    posted_at: row.posted_at || null,
    updated_at: row.updated_at || null
  };
}

export async function loadRedditQueue(db, limit = 60, includeArchived = false) {
  const result = await db.query(
    `SELECT o.*, w.status, w.reddit_url, w.draft_title, w.draft_body,
       w.first_comment, w.llm_model, w.posted_at, w.updated_at
     FROM valuation_hallucination.reddit_opportunities o
     LEFT JOIN valuation_hallucination.reddit_post_workflow w ON w.post_id = o.post_id
     WHERE (o.context_relevant = TRUE AND o.last_seen_at >= NOW() - INTERVAL '21 days'
        OR COALESCE(w.status, '') IN ('draft', 'ready'))
       AND ($2::boolean OR COALESCE(w.status, 'planned') <> 'archived')
     ORDER BY
       CASE COALESCE(w.status, 'planned') WHEN 'ready' THEN 0 WHEN 'draft' THEN 1 WHEN 'planned' THEN 2 ELSE 3 END,
       o.score DESC, o.last_seen_at DESC
     LIMIT $1`,
    [limit, includeArchived]
  );
  return result.rows.map(opportunityRowToPost);
}
