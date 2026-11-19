import { callDesk } from "./desk-api";
import { backgroundRequestSchema } from "./protocol";
import { isExtensionPage, isTrustedSender } from "./sender-guard";
import { loadDeskToken, loadDeskUrl } from "./settings";

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (reply: unknown) => void) => {
  if (!isTrustedSender(sender, chrome.runtime.id)) {
    sendResponse({ ok: false, error: "Unsupported request." });
    return false;
  }
  const request = backgroundRequestSchema.safeParse(message);
  if (!request.success || (request.data.type === "positions" && !isExtensionPage(sender, chrome.runtime.id))) {
    sendResponse({ ok: false, error: "Unsupported request." });
    return false;
  }
  void Promise.all([loadDeskUrl(), loadDeskToken()])
    .then(([url, token]) => callDesk({ url, token }, request.data, (input, init) => fetch(input, init)))
    .then(sendResponse, () => { sendResponse({ ok: false, error: "Could not load the extension settings." }); });
  return true;
});
