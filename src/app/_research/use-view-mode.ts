"use client";

import { useSyncExternalStore } from "react";

export type ViewMode = "beginner" | "pro";

const STORAGE_KEY = "ntd.viewMode";
const CHANGE_EVENT = "ntd:view-mode";
const DEFAULT_MODE: ViewMode = "beginner";

function fromParam(value: string | null): ViewMode | undefined {
  if (value === "pro") return "pro";
  if (value === "beginner" || value === "simple") return "beginner";
  return undefined;
}

function read(): ViewMode {
  const fromUrl = fromParam(new URLSearchParams(window.location.search).get("view"));
  if (fromUrl !== undefined) return fromUrl;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "pro" ? "pro" : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("popstate", onChange);
  };
}

function write(mode: ViewMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    void 0;
  }
  const url = new URL(window.location.href);
  if (mode === "pro") url.searchParams.set("view", "pro");
  else url.searchParams.delete("view");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useViewMode(initial?: ViewMode): readonly [ViewMode, (mode: ViewMode) => void] {
  const mode = useSyncExternalStore(subscribe, read, () => initial ?? DEFAULT_MODE);
  return [mode, write];
}
