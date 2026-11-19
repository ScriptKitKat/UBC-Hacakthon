import { h } from "./dom";
import { sendToBackground } from "./messaging";
import { POPUP_CSS, renderPositions } from "./popup-view";
import { loadDeskUrl } from "./settings";

async function showPositions(root: HTMLElement): Promise<void> {
  try {
    const [reply, deskUrl] = await Promise.all([sendToBackground({ type: "positions" }), loadDeskUrl()]);
    root.replaceChildren(renderPositions(reply, deskUrl));
  } catch {
    root.replaceChildren(renderPositions({ ok: false, error: "Could not load positions." }, ""));
  }
}

document.head.append(h("style", { text: POPUP_CSS }));
const root = document.querySelector<HTMLElement>("#positions");
if (root) void showPositions(root);
