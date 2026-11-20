import { formatResetLabel, nextUtcMidnight } from "@/shared";
import type { DeskSnapshot, HomeRail } from "@/shared";

export function railFromSnapshot(snapshot: DeskSnapshot, now = new Date(), timeZone = "America/Chicago"): HomeRail {
  const resetAt = nextUtcMidnight(now).toISOString();
  return {
    dailyCapCents: snapshot.policy.dailyCapCents,
    spentCents: snapshot.policy.spentCents,
    remainingCents: snapshot.policy.remainingCents,
    perTradeMaxCents: snapshot.policy.perTradeMaxCents,
    autoApproveMaxCents: snapshot.policy.autoApproveMaxCents,
    killSwitch: snapshot.policy.killSwitch,
    senderAllowlist: [...snapshot.policy.senderAllowlist],
    ledgerConfigured: snapshot.ledger.configured,
    resetAt,
    resetLabel: formatResetLabel(resetAt, timeZone),
  };
}
