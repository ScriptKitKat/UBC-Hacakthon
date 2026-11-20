"use client";

import { useEffect, useRef } from "react";

export function useMountTask(task: () => void, restartKey: string): void {
  const latest = useRef(task);
  useEffect(() => {
    latest.current = task;
  });
  useEffect(() => {
    latest.current();
  }, [restartKey]);
}
