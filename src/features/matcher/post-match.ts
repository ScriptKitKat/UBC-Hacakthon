import type { MarketContract, MarketEvent } from "@/features/markets";
import { matchGame } from "./sports";
import { labelDistance, mentionedAmounts, mentionedPercents, normalizePhrase, phrasePosition } from "./text";
import { STRONG, TOPICS, WEAK } from "./topics";
import type { Cue, Topic } from "./topics";

export const MAX_WHY_LENGTH = 110;
export const MIN_POST_SCORE = 5;
const MAX_CONFIDENCE = 0.95;
const SCORE_FOR_FULL_CONFIDENCE = 8;
const EVEN_ODDS_CENTS = 50;
const MIN_SURNAME_LENGTH = 4;
const MIN_NAME_TOKEN_LENGTH = 3;
const GENERIC_NAME_TOKENS: ReadonlySet<string> = new Set(["the", "party", "act", "yes", "before", "above", "below", "winner"]);

export interface PostPick {
  readonly event: MarketEvent;
  readonly contract: MarketContract;
  readonly score: number;
  readonly confidence: number;
  readonly why: string;
}

interface Candidate {
  readonly event: MarketEvent;
  readonly contract: MarketContract;
  readonly score: number;
  readonly position: number;
  readonly why: string;
}

interface CueHit {
  readonly cue: Cue;
  readonly hit: string;
  readonly position: number;
}

interface NameHit {
  readonly contract: MarketContract;
  readonly weight: number;
  readonly position: number;
}

export function isIntradayEvent(event: Pick<MarketEvent, "ticker" | "title">): boolean {
  return /^[A-Z]+\d+M\d/u.test(event.ticker) || /\btoday at\b/iu.test(event.title);
}

export function trimWhy(why: string): string {
  const plain = why.replace(/\s+/gu, " ").trim();
  if (plain.length <= MAX_WHY_LENGTH) return plain;
  const room = plain.slice(0, MAX_WHY_LENGTH - 1);
  const boundary = room.lastIndexOf(" ");
  return `${(boundary > 0 ? room.slice(0, boundary) : room).replace(/[\s,;:–-]+$/u, "")}…`;
}

function isOpen(contract: MarketContract): boolean {
  return contract.status === "active" && contract.marketState === "open" && contract.prices.buyYesCents !== null;
}

function yesCents(contract: MarketContract): number {
  return contract.prices.buyYesCents ?? 0;
}

function favourite(contracts: readonly MarketContract[]): MarketContract | undefined {
  return [...contracts].sort((a, b) => yesCents(b) - yesCents(a))[0];
}

function nearestEvenOdds(contracts: readonly MarketContract[]): MarketContract | undefined {
  return [...contracts].sort((a, b) => Math.abs(yesCents(a) - EVEN_ODDS_CENTS) - Math.abs(yesCents(b) - EVEN_ODDS_CENTS))[0];
}

function matchedCues(topic: Topic, text: string): readonly CueHit[] {
  return topic.cues.flatMap((cue) => {
    const match = cue.pattern.exec(text);
    return match ? [{ cue, hit: match[0], position: match.index }] : [];
  });
}

function nameHit(contract: MarketContract, normalizedText: string): NameHit | undefined {
  const tokens = normalizePhrase(contract.label.replace(/\sparty$/iu, ""))
    .split(" ")
    .filter((token) => token.length >= MIN_NAME_TOKEN_LENGTH && !/\d/u.test(token) && !GENERIC_NAME_TOKENS.has(token));
  const found = tokens.map((token) => ({ token, position: phrasePosition(normalizedText, token) })).filter((entry) => entry.position >= 0);
  if (found.length === 0) return undefined;
  const position = Math.min(...found.map((entry) => entry.position));
  if (found.length >= Math.min(2, tokens.length)) return { contract, weight: STRONG, position };
  const surname = tokens.at(-1) ?? "";
  return surname.length >= MIN_SURNAME_LENGTH && found.some((entry) => entry.token === surname) ? { contract, weight: WEAK, position } : undefined;
}

function bestNameHit(contracts: readonly MarketContract[], normalizedText: string): NameHit | undefined {
  return contracts
    .flatMap((contract) => nameHit(contract, normalizedText) ?? [])
    .sort((a, b) => b.weight - a.weight || a.position - b.position || yesCents(b.contract) - yesCents(a.contract))[0];
}

function cueContract(topic: Topic, contracts: readonly MarketContract[], text: string): MarketContract | undefined {
  const hits = contracts.flatMap((contract) => {
    const positions = (topic.contractCues ?? []).flatMap((contractCue) => {
      const match = contractCue.label.test(contract.label) ? contractCue.post.exec(text) : null;
      return match ? [match.index] : [];
    });
    return positions.length > 0 ? [{ contract, position: Math.min(...positions) }] : [];
  });
  return hits.sort((a, b) => a.position - b.position || yesCents(b.contract) - yesCents(a.contract))[0]?.contract;
}

function numericContract(topic: Topic, contracts: readonly MarketContract[], text: string): MarketContract | undefined {
  if (!topic.numbers) return undefined;
  const mentioned = (topic.numbers === "percents" ? mentionedPercents(text) : mentionedAmounts(text))[0];
  if (mentioned === undefined) return undefined;
  const ranked = contracts
    .map((contract) => ({ contract, distance: labelDistance(contract.label, mentioned) }))
    .filter((entry) => Number.isFinite(entry.distance));
  const nearest = Math.min(...ranked.map((entry) => entry.distance));
  return nearestEvenOdds(ranked.filter((entry) => entry.distance === nearest).map((entry) => entry.contract));
}

function sentence(template: string, hit: string, contract: MarketContract, event: MarketEvent): string {
  const filled = template
    .replaceAll("{hit}", hit.trim())
    .replaceAll("{label}", contract.label)
    .replaceAll("{pct}", `${String(yesCents(contract))}%`)
    .replaceAll("{title}", event.title.replace(/\?$/u, ""));
  return trimWhy(`${filled.charAt(0).toUpperCase()}${filled.slice(1)}`);
}

function strongestCue(hits: readonly CueHit[]): CueHit | undefined {
  return [...hits].sort((a, b) => b.cue.weight - a.cue.weight || a.position - b.position)[0];
}

function scoreTopicEvent(topic: Topic, event: MarketEvent, text: string, normalizedText: string): Candidate | undefined {
  const open = event.contracts.filter(isOpen);
  if (open.length === 0) return undefined;
  const cues = matchedCues(topic, text);
  const contextScore = cues.reduce((total, entry) => total + entry.cue.weight, 0);
  const named = topic.names ? bestNameHit(open, normalizedText) : undefined;
  const usableName = named && (topic.names === "standalone" || contextScore >= WEAK) ? named : undefined;
  if (cues.length === 0 && !usableName) return undefined;
  const contract =
    cueContract(topic, open, text) ??
    usableName?.contract ??
    numericContract(topic, open, text) ??
    (topic.fallback === "favourite" ? favourite(open) : nearestEvenOdds(open));
  if (!contract) return undefined;
  const lead = strongestCue(cues);
  const positions = [...cues.map((entry) => entry.position), ...(usableName ? [usableName.position] : [])];
  const why = lead
    ? sentence(lead.cue.reason, lead.hit, contract, event)
    : sentence("{label} is priced at {pct} in {title}.", "", contract, event);
  return {
    event,
    contract,
    score: contextScore + (usableName?.weight ?? 0),
    position: Math.min(...positions),
    why,
  };
}

function expiresAfter(event: MarketEvent, now: Date): boolean {
  return event.expiryDate === null || Date.parse(event.expiryDate) > now.getTime();
}

function topicCandidates(topic: Topic, events: readonly MarketEvent[], text: string, normalizedText: string, now: Date): readonly Candidate[] {
  const matching = events.filter((event) => topic.tickers.test(event.ticker));
  if (!topic.nearestExpiry) return matching.flatMap((event) => scoreTopicEvent(topic, event, text, normalizedText) ?? []);
  const upcoming = matching
    .filter((event) => expiresAfter(event, now))
    .sort((a, b) => Date.parse(a.expiryDate ?? "") - Date.parse(b.expiryDate ?? ""));
  for (const event of upcoming) {
    const candidate = scoreTopicEvent(topic, event, text, normalizedText);
    if (candidate) return [candidate];
  }
  return [];
}

function gameCandidate(text: string, events: readonly MarketEvent[]): Candidate | undefined {
  const game = matchGame(text, events);
  if (!game) return undefined;
  return {
    event: game.event,
    contract: game.contract,
    score: game.score,
    position: game.position,
    why: game.why,
  };
}

export function matchPostToEvents(text: string, events: readonly MarketEvent[], now: Date): PostPick | undefined {
  const live = events.filter((event) => event.status === "active" && !isIntradayEvent(event));
  const normalizedText = normalizePhrase(text);
  const game = gameCandidate(text, live);
  const candidates = [...TOPICS.flatMap((topic) => topicCandidates(topic, live, text, normalizedText, now)), ...(game ? [game] : [])];
  const best = candidates.sort((a, b) => b.score - a.score || a.position - b.position)[0];
  if (!best || best.score < MIN_POST_SCORE) return undefined;
  return {
    event: best.event,
    contract: best.contract,
    score: best.score,
    confidence: Math.min(MAX_CONFIDENCE, best.score / SCORE_FOR_FULL_CONFIDENCE),
    why: best.why,
  };
}
