import type { BackgroundReply, Sender } from "./protocol";

const UNAVAILABLE: BackgroundReply<never> = { ok: false, error: "The extension was reloaded. Refresh the page." };

function isReply(value: unknown): value is BackgroundReply<never> {
  return typeof value === "object" && value !== null && "ok" in value;
}

export const sendToBackground: Sender = async (request) => {
  try {
    const reply: unknown = await chrome.runtime.sendMessage(request);
    return isReply(reply) ? reply : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
};
