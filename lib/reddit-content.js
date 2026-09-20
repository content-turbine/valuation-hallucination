export const PRIORITY_REDDIT_SUBREDDITS = [
  "SideProject",
  "EntrepreneurRideAlong",
  "BoardgameDesign",
  "tabletopgamedesign",
  "playtesters",
  "boardgames",
  "startups",
  "venturecapital",
  "ProgrammerHumor",
  "Kickstarter"
];

export const DEFAULT_REDDIT_SUBREDDITS = [
  ...PRIORITY_REDDIT_SUBREDDITS,
  "Entrepreneur"
];

const noLinkCommunities = new Set([
  "boardgamedesign",
  "tabletopgamedesign",
  "playtesters",
  "startups",
  "entrepreneur"
]);

const credibleCommunities = new Set([
  "boardgamedesign",
  "tabletopgamedesign",
  "playtesters",
  "boardgames"
]);

export function redditSubreddits(value = process.env.REDDIT_SUBREDDITS) {
  const configured = String(value || "")
    .split(",")
    .map((item) => item.trim().replace(/^r\//i, ""))
    .filter((item) => /^[A-Za-z0-9_]{2,40}$/.test(item));
  return [...new Set([...PRIORITY_REDDIT_SUBREDDITS, ...configured, ...DEFAULT_REDDIT_SUBREDDITS])];
}

export function normalizedPostStatus(value) {
  const status = String(value || "").toLowerCase();
  return ["planned", "draft", "ready", "posted", "skipped", "blocked", "archived"].includes(status)
    ? status
    : "planned";
}

export function redditStrategyTags(subreddit) {
  const normalized = String(subreddit || "").toLowerCase();
  return [
    credibleCommunities.has(normalized) ? "credible" : "awareness",
    normalized === "kickstarter" ? "launch" : "pre-launch"
  ];
}

export function opportunityGuidance(subreddit) {
  const normalized = String(subreddit || "").toLowerCase();
  const designCommunity = normalized.includes("game") || normalized === "playtesters";
  if (designCommunity) {
    return {
      phase: "product feedback",
      linkMode: "none",
      cta: "Ask one concrete design or playtesting question. Do not include a promotional link."
    };
  }
  if (noLinkCommunities.has(normalized)) {
    return {
      phase: "community research",
      linkMode: "none",
      cta: "Contribute a useful founder lesson and invite discussion without a product link."
    };
  }
  return {
    phase: "audience growth",
    linkMode: "soft",
    cta: "Lead with value. Share the tracked Founder ID link only if the community rules permit it."
  };
}

export function opportunityFromSource(source) {
  const guidance = opportunityGuidance(source.subreddit);
  const tags = Array.isArray(source.tags) && source.tags.length
    ? source.tags
    : redditStrategyTags(source.subreddit);
  return {
    id: source.post_id,
    subreddit: source.subreddit,
    phase: guidance.phase,
    title: `Current discussion: ${source.source_title}`,
    angle: `Use the live discussion “${source.source_title}” as a signal. Write a distinct, standalone post that adds one specific lesson, question, or game-design decision from Valuation Hallucination; do not copy or pretend to have participated in the source thread.`,
    cta: guidance.cta,
    linkMode: guidance.linkMode,
    status: "planned",
    sourceUrl: source.source_url,
    sourceTitle: source.source_title,
    sourceExcerpt: source.source_excerpt || "",
    sourcePublishedAt: source.source_published_at,
    discoveredAt: source.discovered_at,
    lastSeenAt: source.last_seen_at,
    score: Number(source.score || 0),
    tags,
    contextScore: Number(source.context_score || 0),
    relevanceReasons: Array.isArray(source.relevance_reasons) ? source.relevance_reasons : []
  };
}

export function nextPostRecommendation(performance = [], queue = []) {
  const winner = performance.find((item) => Number(item.signups) > 0) || performance[0];
  const available = queue.filter((item) => !["posted", "skipped", "blocked", "archived"].includes(normalizedPostStatus(item.status)));
  const next = available.find((item) => normalizedPostStatus(item.status) === "ready")
    || available.find((item) => normalizedPostStatus(item.status) === "draft")
    || available[0]
    || null;
  if (!next) return null;
  return {
    ...next,
    reason: winner
      ? `${winner.subreddit ? `r/${winner.subreddit}` : winner.source || "The current leader"} is producing the strongest measured signal. This live Reddit topic is the highest-ranked uncompleted opportunity.`
      : "This is the highest-ranked current Reddit signal that has not been posted or skipped."
  };
}

export function scheduledPostRecommendation(performance = [], date = new Date(), queue = []) {
  const available = queue.filter((item) => !["posted", "skipped", "blocked", "archived"].includes(normalizedPostStatus(item.status)));
  if (!available.length) return null;
  const ready = available.filter((item) => ["ready", "draft"].includes(normalizedPostStatus(item.status)));
  const candidates = ready.length ? ready : available;
  const day = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
  const selected = candidates[Math.abs(day) % candidates.length];
  return nextPostRecommendation(performance, [selected]);
}
