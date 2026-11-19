"use client";

import type { ProShell } from "@/shared";
import { ResearchPage } from "../_research/research-page";
import { useViewMode } from "../_research/use-view-mode";
import type { ViewMode } from "../_research/use-view-mode";
import { ProPage } from "./pro/pro-page";

export function MarketDetail({
  symbol,
  initialView,
  initialPro,
}: {
  readonly symbol: string;
  readonly initialView?: ViewMode;
  readonly initialPro?: ProShell;
}) {
  const [mode] = useViewMode(initialView);
  if (mode === "pro") return <ProPage symbol={symbol} {...(initialPro === undefined ? {} : { initial: initialPro })} />;
  return <ResearchPage symbol={symbol} {...(initialView === undefined ? {} : { initialView })} />;
}
