import type { DeskSnapshot, HomeRail } from "@/shared";

export function railFromSnapshot(snapshot: DeskSnapshot): HomeRail {
  return {
    dailyCapCents: snapshot.policy.dailyCapCents,
    spentCents: snapshot.policy.spentCents,
    remainingCents: snapshot.policy.remainingCents,
    perTradeMaxCents: snapshot.policy.perTradeMaxCents,
    autoApproveMaxCents: snapshot.policy.autoApproveMaxCents,
    killSwitch: snapshot.policy.killSwitch,
    pendingCount: snapshot.pending.length,
    senderAllowlist: [...snapshot.policy.senderAllowlist],
    ledgerConfigured: snapshot.ledger.configured,
    resetLabel: "resets 12:00 am UTC",
  };
}
