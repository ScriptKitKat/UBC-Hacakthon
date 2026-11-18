"use client";

import { useEffect, useRef } from "react";

export function usePolling(task: () => void, intervalMs: number): void {
  const latest = useRef(task);
  useEffect(() => {
    latest.current = task;
  });
  useEffect(() => {
    latest.current();
    const timer = setInterval(() => {
      latest.current();
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [intervalMs]);
}
