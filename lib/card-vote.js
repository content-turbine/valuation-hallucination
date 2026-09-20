const fallbackCards = [
  {
    id: "candidate-1",
    number: 1,
    revealAt: "2026-09-28T16:00:00.000Z",
    category: "Hype",
    title: "Ghost Users",
    flavor: "Your waitlist is enormous. Your active-user chart is… conceptual.",
    effect: "+$100M valuation",
    accent: "acid"
  },
  {
    id: "candidate-2",
    number: 2,
    revealAt: "2026-10-15T16:00:00.000Z",
    category: "Capital",
    title: "Demo Day Miracle",
    flavor: "The prototype worked once. Investors saw everything they needed.",
    effect: "+$150M valuation",
    accent: "pink"
  },
  {
    id: "candidate-3",
    number: 3,
    revealAt: "2026-10-30T16:00:00.000Z",
    category: "Chaos",
    title: "Founder Mode",
    flavor: "Replace sleep with a motivational LinkedIn post.",
    effect: "Draw 2. Regret 1.",
    accent: "violet"
  }
];

function envCard(card) {
  const prefix = `CARD_VOTE_${card.number}`;
  return {
    ...card,
    revealAt: process.env[`${prefix}_REVEAL_AT`] || card.revealAt,
    category: process.env[`${prefix}_CATEGORY`] || card.category,
    title: process.env[`${prefix}_TITLE`] || card.title,
    flavor: process.env[`${prefix}_FLAVOR`] || card.flavor,
    effect: process.env[`${prefix}_EFFECT`] || card.effect
  };
}

export const cardVoteCards = fallbackCards.map(envCard);
export const cardVoteClosesAt = process.env.CARD_VOTE_CLOSES_AT || "2026-11-07T04:59:00.000Z";

export function cardVoteState(now = new Date()) {
  const timestamp = now.getTime();
  const cards = cardVoteCards.map((card) => {
    const revealed = timestamp >= new Date(card.revealAt).getTime();
    const publicCard = {
      id: card.id,
      number: card.number,
      reveal_at: card.revealAt,
      revealed,
      accent: card.accent
    };
    if (!revealed) return publicCard;
    return {
      ...publicCard,
      category: card.category,
      title: card.title,
      flavor: card.flavor,
      effect: card.effect
    };
  });
  const opensAt = cardVoteCards.reduce((latest, card) => {
    return new Date(card.revealAt).getTime() > new Date(latest).getTime() ? card.revealAt : latest;
  }, cardVoteCards[0].revealAt);
  const open = timestamp >= new Date(opensAt).getTime() && timestamp < new Date(cardVoteClosesAt).getTime();
  const closed = timestamp >= new Date(cardVoteClosesAt).getTime();
  return {
    server_time: now.toISOString(),
    cards,
    voting: {
      opens_at: opensAt,
      closes_at: cardVoteClosesAt,
      open,
      closed
    }
  };
}

export function isCardVoteChoice(value) {
  return cardVoteCards.some((card) => card.id === value);
}
