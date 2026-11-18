import type { MarketContract, MarketEvent } from "@/features/markets";
import { normalizePhrase, phrasePosition } from "./text";
import { TEAMS } from "./teams";
import type { Team } from "./teams";

const MONEYLINE_SUFFIX = /-M$/u;
const SIDE_QUALIFIER = /\s[A-Z]$/u;
const MAX_SEARCH_TERMS = 3;
const NICKNAME_SCORE = 5;
const CITY_SCORE = 3;

interface SideMention {
  readonly side: string;
  readonly score: number;
  readonly position: number;
  readonly hit: string;
}

export interface GamePick {
  readonly event: MarketEvent;
  readonly contract: MarketContract;
  readonly score: number;
  readonly position: number;
  readonly hits: readonly string[];
}

function city(side: string): string {
  return side.replace(SIDE_QUALIFIER, "");
}

function leagueOf(event: MarketEvent): string {
  return event.ticker.split("-")[0] ?? "";
}

function mentionedTeams(normalizedText: string): readonly Team[] {
  return TEAMS.filter((team) => team.aliases.some((alias) => phrasePosition(normalizedText, alias) >= 0));
}

export function sportsSearchTerms(text: string): readonly string[] {
  const normalized = normalizePhrase(text);
  const nicknames = mentionedTeams(normalized).map((team) => city(team.side));
  const cities = TEAMS.map((team) => city(team.side)).filter((name) => phrasePosition(normalized, normalizePhrase(name)) >= 0);
  return [...new Set([...nicknames, ...cities])].slice(0, MAX_SEARCH_TERMS);
}

function titleCase(phrase: string): string {
  return phrase.replace(/\b[a-z]/gu, (letter) => letter.toUpperCase());
}

function mentionOf(side: string, league: string, normalized: string): SideMention | undefined {
  const nickname = TEAMS.filter((team) => team.league === league && team.side === side)
    .flatMap((team) => team.aliases)
    .map((alias) => ({ alias, position: phrasePosition(normalized, alias) }))
    .filter((found) => found.position >= 0)
    .sort((a, b) => a.position - b.position)[0];
  if (nickname) return { side, score: NICKNAME_SCORE, position: nickname.position, hit: titleCase(nickname.alias) };
  const position = phrasePosition(normalized, normalizePhrase(city(side)));
  return position < 0 ? undefined : { side, score: CITY_SCORE, position, hit: city(side) };
}

function isOpen(contract: MarketContract): boolean {
  return contract.status === "active" && contract.marketState === "open" && contract.prices.buyYesCents !== null;
}

function chooseContract(event: MarketEvent, mentions: readonly SideMention[]): MarketContract | undefined {
  const open = event.contracts.filter(isOpen);
  const [first] = mentions;
  return open.find((contract) => contract.label === first?.side) ?? open.find((contract) => !/^tie$/iu.test(contract.label));
}

export function matchGame(text: string, events: readonly MarketEvent[]): GamePick | undefined {
  const normalized = normalizePhrase(text);
  const picks: GamePick[] = [];
  for (const event of events) {
    if (!MONEYLINE_SUFFIX.test(event.ticker) || event.status !== "active") continue;
    const sides = event.title.split(" vs ");
    if (sides.length !== 2) continue;
    const mentions = sides
      .flatMap((side) => mentionOf(side, leagueOf(event), normalized) ?? [])
      .sort((a, b) => a.position - b.position);
    const contract = chooseContract(event, mentions);
    if (mentions.length === 0 || !contract) continue;
    picks.push({
      event,
      contract,
      score: mentions.reduce((total, mention) => total + mention.score, 0),
      position: Math.min(...mentions.map((mention) => mention.position)),
      hits: mentions.map((mention) => mention.hit),
    });
  }
  return picks.sort((a, b) => b.score - a.score || a.position - b.position)[0];
}
