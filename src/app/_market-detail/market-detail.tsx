"use client";

import { useState } from "react";
import type { ProShell } from "@/shared";
import { useMountTask } from "../_desk/use-mount-task";
import { ResearchPage } from "../_research/research-page";
import { useViewMode } from "../_research/use-view-mode";
import type { ViewMode } from "../_research/use-view-mode";
import { loadChatter } from "./chatter-api";
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
  const [chatterLoads, setChatterLoads] = useState(0);
  useMountTask(() => {
    void loadChatter(symbol).then((loaded) => {
      if (loaded) setChatterLoads((count) => count + 1);
    });
  }, symbol);
  if (mode === "pro") return <ProPage symbol={symbol} refreshKey={chatterLoads} {...(initialPro === undefined ? {} : { initial: initialPro })} />;
  return <ResearchPage symbol={symbol} refreshKey={chatterLoads} {...(initialView === undefined ? {} : { initialView })} />;
}
