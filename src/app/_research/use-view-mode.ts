"use client";

import { useSyncExternalStore } from "react";

export type ViewMode = "beginner" | "pro";

const STORAGE_KEY = "ntd.viewMode";
const CHANGE_EVENT = "ntd:view-mode";
const DEFAULT_MODE: ViewMode = "beginner";

function read(): ViewMode {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "pro" ? "pro" : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function write(mode: ViewMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useViewMode(): readonly [ViewMode, (mode: ViewMode) => void] {
  const mode = useSyncExternalStore(subscribe, read, () => DEFAULT_MODE);
  return [mode, write];
}
