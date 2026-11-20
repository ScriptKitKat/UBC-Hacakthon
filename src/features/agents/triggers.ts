import { pointDelta } from "@/shared";
import {
  BRIEF_ODDS_MOVE_POINTS,
  ENDING_SOON_MS,
  ODDS_MOVE_POINTS,
  TRIGGER_COOLDOWN_MS,
  VOLUME_SPIKE_MULTIPLE,
  X_SURGE_MIN_POSTS,
  X_SURGE_MULTIPLE,
  type AgentRecord,
  type BriefTriggerId,
  type TriggerId,
  type WatchTriggerId,
} from "./types";
import type { XSignals } from "@/features/xfeed";

export interface MarketSnapshot {
  readonly eventTitle: string | null;
  readonly yesCents: number | null;
  readonly yesCents24hAgo: number | null;
  readonly volume24h: number | null;
  readonly volumeTotal: number | null;
  readonly createdAt: string | null;
  readonly expiryDate: string | null;
}

export interface TriggerSkip {
  readonly id: TriggerId;
  readonly reason: string;
}

export interface TriggerResult {
  readonly fired: readonly TriggerId[];
  readonly skipped: readonly TriggerSkip[];
  readonly todayPoints: number | null;
  readonly x?: XSignals | undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function todayPoints(snapshot: Pick<MarketSnapshot, "yesCents" | "yesCents24hAgo">): number | null {
  return pointDelta(snapshot.yesCents24hAgo, snapshot.yesCents);
}

export function volumeMultiple(snapshot: Pick<MarketSnapshot, "volume24h" | "volumeTotal" | "createdAt">, now: Date): number | null {
  if (snapshot.volume24h === null || snapshot.volumeTotal === null || snapshot.volume24h < 0 || snapshot.volumeTotal < 0) return null;
  const created = snapshot.createdAt === null ? Number.NaN : Date.parse(snapshot.createdAt);
  if (!Number.isFinite(created) || created >= now.getTime()) return null;
  const ageDays = Math.max(1, (now.getTime() - created) / DAY_MS);
  const priorDays = Math.max(1, ageDays - 1);
  const priorVolume = Math.max(0, snapshot.volumeTotal - snapshot.volume24h);
  const dailyNormal = priorVolume / priorDays;
  if (!(dailyNormal > 0)) return null;
  return snapshot.volume24h / dailyNormal;
}

export function hoursToExpiry(snapshot: Pick<MarketSnapshot, "expiryDate">, now: Date): number | null {
  if (snapshot.expiryDate === null) return null;
  const remaining = Date.parse(snapshot.expiryDate) - now.getTime();
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  return remaining / (60 * 60 * 1000);
}

export function crossedLevel(previous: number | null, current: number | null, level: number | null): boolean {
  if (previous === null || current === null || level === null) return false;
  if (!Number.isFinite(level) || level < 0 || level > 100) return false;
  return (previous - level) * (current - level) <= 0 && previous !== current;
}

export function isMondayInZone(now: Date, timeZone = "America/Chicago"): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
  return weekday === "Mon";
}

export function shouldFire(lastAt: string | undefined, now: Date, cooldownMs: number): boolean {
  if (lastAt === undefined) return true;
  const then = Date.parse(lastAt);
  if (!Number.isFinite(then)) return true;
  return now.getTime() - then >= cooldownMs;
}

function cooled(id: TriggerId, agent: AgentRecord, now: Date, cooldownMs: number, skipped: TriggerSkip[], ignoreCooldowns = false): boolean {
  if (ignoreCooldowns) return true;
  if (shouldFire(agent.lastTriggerAt[id], now, cooldownMs)) return true;
  skipped.push({ id, reason: "already reported this move" });
  return false;
}

export function evaluateTriggers(
  agent: AgentRecord,
  snapshot: MarketSnapshot,
  now: Date,
  options: { readonly xFeedAvailable: boolean; readonly x?: XSignals | undefined; readonly timeZone?: string; readonly ignoreCooldowns?: boolean } = { xFeedAvailable: false },
): TriggerResult {
  const skipped: TriggerSkip[] = [];
  const fired: TriggerId[] = [];
  const points = todayPoints(snapshot);
  const watch = agent.triggers;

  if (watch.oddsMove) {
    if (points !== null && Math.abs(points) >= ODDS_MOVE_POINTS) {
      if (cooled("oddsMove", agent, now, TRIGGER_COOLDOWN_MS, skipped, options.ignoreCooldowns)) fired.push("oddsMove");
    }
  }
  if (watch.volumeSpike) {
    const multiple = volumeMultiple(snapshot, now);
    if (multiple !== null && multiple >= VOLUME_SPIKE_MULTIPLE) {
      if (cooled("volumeSpike", agent, now, TRIGGER_COOLDOWN_MS, skipped, options.ignoreCooldowns)) fired.push("volumeSpike");
    }
  }
  if (watch.xMentions) {
    if (!options.xFeedAvailable) {
      skipped.push({ id: "xMentions", reason: "needs X_BEARER_TOKEN" });
    } else if (options.x?.counts === undefined) {
      skipped.push({ id: "xMentions", reason: "X data unavailable" });
    } else if (
      options.x.counts.lastHourCount >= X_SURGE_MULTIPLE * Math.max(options.x.counts.baselineHourlyCount, 1) &&
      options.x.counts.lastHourCount >= X_SURGE_MIN_POSTS &&
      cooled("xMentions", agent, now, TRIGGER_COOLDOWN_MS, skipped, options.ignoreCooldowns)
    ) {
      fired.push("xMentions");
    }
  }
  if (watch.breakingNews) {
    if (!options.xFeedAvailable) {
      skipped.push({ id: "breakingNews", reason: "needs X_BEARER_TOKEN" });
    } else if (options.x?.breakingPost === undefined) {
      skipped.push({ id: "breakingNews", reason: "X data unavailable" });
    } else if (
      options.x.breakingPost !== null &&
      options.x.breakingPost.id !== agent.lastBreakingPostId &&
      cooled("breakingNews", agent, now, TRIGGER_COOLDOWN_MS, skipped, options.ignoreCooldowns)
    ) {
      fired.push("breakingNews");
    }
  }
  if (watch.oddsCross) {
    if (crossedLevel(snapshot.yesCents24hAgo, snapshot.yesCents, watch.oddsCrossLevel)) {
      if (cooled("oddsCross", agent, now, TRIGGER_COOLDOWN_MS, skipped, options.ignoreCooldowns)) fired.push("oddsCross");
    }
  }
  if (watch.endingSoon) {
    const remaining = snapshot.expiryDate === null ? Number.NaN : Date.parse(snapshot.expiryDate) - now.getTime();
    if (Number.isFinite(remaining) && remaining > 0 && remaining <= ENDING_SOON_MS) {
      if (cooled("endingSoon", agent, now, ENDING_SOON_MS, skipped, options.ignoreCooldowns)) fired.push("endingSoon");
    }
  }

  if (agent.writeBriefs) {
    const briefs = agent.briefTriggers;
    if (briefs.oddsMove10 && points !== null && Math.abs(points) >= BRIEF_ODDS_MOVE_POINTS) {
      if (cooled("briefOddsMove10", agent, now, TRIGGER_COOLDOWN_MS, skipped, options.ignoreCooldowns)) fired.push("briefOddsMove10");
    }
    if (briefs.everyMonday && isMondayInZone(now, options.timeZone)) {
      if (cooled("briefMonday", agent, now, 6 * DAY_MS, skipped, options.ignoreCooldowns)) fired.push("briefMonday");
    }
    if (briefs.endingSoon) {
      const remaining = snapshot.expiryDate === null ? Number.NaN : Date.parse(snapshot.expiryDate) - now.getTime();
      if (Number.isFinite(remaining) && remaining > 0 && remaining <= ENDING_SOON_MS) {
        if (cooled("briefEndingSoon", agent, now, ENDING_SOON_MS, skipped, options.ignoreCooldowns)) fired.push("briefEndingSoon");
      }
    }
  }

  return { fired, skipped, todayPoints: points, ...(options.x === undefined ? {} : { x: options.x }) };
}

export function isBriefTrigger(id: TriggerId): id is BriefTriggerId {
  return id === "briefOddsMove10" || id === "briefMonday" || id === "briefEndingSoon";
}

export function isWatchTrigger(id: TriggerId): id is WatchTriggerId {
  return !isBriefTrigger(id);
}
