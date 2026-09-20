export const redditQueue = [
  {
    id: "sideproject-origin",
    phase: "awareness",
    subreddit: "SideProject",
    title: "I got tired of startup valuations making no sense, so I’m turning them into a card game",
    angle: "Founder story + three readable cards + one genuine question.",
    cta: "What is the most ridiculous startup trope I’m missing?",
    linkMode: "soft",
    status: "ready"
  },
  {
    id: "startup-stories",
    phase: "research",
    subreddit: "EntrepreneurRideAlong",
    title: "What’s something you’ve seen at a startup that sounds completely made up?",
    angle: "Invite stories; explain that the best patterns may inspire a satirical card.",
    cta: "Comments only. Add the site link only if a moderator permits it.",
    linkMode: "none",
    status: "ready"
  },
  {
    id: "ridealong-build",
    phase: "awareness",
    subreddit: "EntrepreneurRideAlong",
    title: "What I learned turning startup absurdity into a physical card game before Kickstarter",
    angle: "Share concrete lessons: simplify the loop, test jokes separately from mechanics, and build the audience before crowdfunding.",
    cta: "Add the Founder ID link only after the useful build lessons.",
    linkMode: "tracked",
    status: "ready"
  },
  {
    id: "valuation-game",
    phase: "engagement",
    subreddit: "SideProject",
    title: "Give this pre-revenue AI startup a valuation",
    angle: "Present one fictional startup with ridiculous metrics and let commenters assign its valuation.",
    cta: "Reveal the game mechanic after discussion has started; share the Founder ID only with interested readers.",
    linkMode: "soft",
    status: "draft"
  },
  {
    id: "sabotage-design",
    phase: "credibility",
    subreddit: "BoardgameDesign",
    title: "When does sabotage in a card game stop being funny and start feeling unfair?",
    angle: "Show the actual raise → build → sabotage → survive → exit loop and ask for mechanical critique.",
    cta: "No waitlist link; this is a design discussion.",
    linkMode: "none",
    status: "ready"
  },
  {
    id: "roast-card-01",
    phase: "engagement",
    subreddit: "tabletopgamedesign",
    title: "Roast this startup-satire card: too much text, too inside-baseball, or actually playable?",
    angle: "One legible card, specific questions, and a promise to show the revision.",
    cta: "No waitlist link; return later with the before/after.",
    linkMode: "none",
    status: "draft"
  },
  {
    id: "founder-id-reveal",
    phase: "conversion",
    subreddit: "SideProject",
    title: "I made a fake startup valuation generator for the card game Reddit is helping me build",
    angle: "Founder ID reveal, archetype, virtual valuation and referral leaderboard.",
    cta: "Get your Founder ID and tell me whether your valuation is sufficiently unjustifiable.",
    linkMode: "tracked",
    status: "ready"
  },
  {
    id: "reddit-changed-card",
    phase: "proof",
    subreddit: "SideProject",
    title: "Reddit roasted my startup card. Here’s what changed.",
    angle: "Show a legible before/after and name the three design changes prompted by community feedback.",
    cta: "Invite readers to get a Founder ID and vote on a future community card.",
    linkMode: "tracked",
    status: "waiting-for-input"
  },
  {
    id: "playtest",
    phase: "validation",
    subreddit: "playtesters",
    title: "Looking for playtesters for a satirical AI-startup card game",
    angle: "State the format, time commitment, prototype access and exact feedback needed.",
    cta: "Use a direct playtest link; never gate playtesting behind the marketing waitlist.",
    linkMode: "none",
    status: "waiting-for-prototype"
  },
  {
    id: "community-card",
    phase: "engagement",
    subreddit: "SideProject",
    title: "Which startup disaster should become an actual card?",
    angle: "Give three Market Event choices and ask readers to select or improve one.",
    cta: "Invite interested commenters to the Founder ID/community-vote page.",
    linkMode: "tracked",
    status: "draft"
  },
  {
    id: "reddit-made-cards",
    phase: "proof",
    subreddit: "EntrepreneurRideAlong",
    title: "I asked founders for absurd startup stories. Here are the five becoming cards.",
    angle: "Close the loop with attribution, product changes and what surprised you.",
    cta: "Vote on which one makes the final deck.",
    linkMode: "tracked",
    status: "waiting-for-input"
  },
  {
    id: "prelaunch-recap",
    phase: "conversion",
    subreddit: "EntrepreneurRideAlong",
    title: "30 days before crowdfunding: what Reddit traffic actually converted for my card game",
    angle: "Share visits, signup conversion and referrals by subreddit, plus what you changed because of the data.",
    cta: "Link to the project only after the numbers and lessons.",
    linkMode: "tracked",
    status: "waiting-for-data"
  }
];

export function nextPostRecommendation(performance = []) {
  const winner = performance.find((item) => Number(item.signups) > 0) || performance[0];
  const next = redditQueue.find((item) => item.status === "ready") || redditQueue[0];
  if (!winner) return { ...next, reason: "No campaign has converted yet, so start with the strongest founder-story test." };
  return {
    ...next,
    reason: `${winner.subreddit || winner.source || "Reddit"} / ${winner.content || winner.campaign || "current leader"} is producing the strongest measured signal. Keep its hook style, but use this next distinct community-native angle.`
  };
}

export function scheduledPostRecommendation(performance = [], date = new Date()) {
  const ready = redditQueue.filter((item) => item.status === "ready");
  const day = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
  const selected = ready[Math.abs(day) % ready.length] || redditQueue[0];
  const winner = performance.find((item) => Number(item.signups) > 0) || performance[0];
  return {
    ...selected,
    reason: winner
      ? `Borrow the hook structure from ${winner.subreddit ? `r/${winner.subreddit}` : winner.source || "the current leader"} / ${winner.content || winner.campaign || "top content"}, which has produced ${winner.signups || 0} measured lead(s).`
      : "No campaign has converted yet; use this as the next clean organic test."
  };
}
