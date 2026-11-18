import { callDesk } from "./desk-api";
import { backgroundRequestSchema } from "./protocol";
import { loadDeskUrl } from "./settings";

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (reply: unknown) => void) => {
  const request = backgroundRequestSchema.safeParse(message);
  if (!request.success) {
    sendResponse({ ok: false, error: "Unsupported request." });
    return false;
  }
  void loadDeskUrl()
    .then((deskUrl) => callDesk(deskUrl, request.data, (input, init) => fetch(input, init)))
    .then(sendResponse);
  return true;
});
