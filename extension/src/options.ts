import { DEFAULT_DESK_URL, isLocalHost, loadDeskUrl, parseDeskUrl, saveDeskToken, saveDeskUrl } from "./settings";

const form = document.querySelector<HTMLFormElement>("#settings");
const input = document.querySelector<HTMLInputElement>("#desk-url");
const tokenInput = document.querySelector<HTMLInputElement>("#desk-token");
const status = document.querySelector<HTMLElement>("#status");

function show(message: string, failed: boolean): void {
  if (!status) return;
  status.textContent = message;
  status.dataset.failed = String(failed);
}

async function ensurePermission(url: string): Promise<boolean> {
  if (isLocalHost(url)) return true;
  return chrome.permissions.request({ origins: [`${url}/*`] });
}

async function save(text: string, token: string): Promise<void> {
  const url = parseDeskUrl(text);
  if (url === undefined) {
    show("Enter an https URL (http is only allowed for localhost), for example http://localhost:3000.", true);
    return;
  }
  if (!(await ensurePermission(url))) {
    show("Permission to reach that desk was not granted.", true);
    return;
  }
  await saveDeskUrl(url);
  if (token.trim() !== "") await saveDeskToken(token);
  show(`Saved. The extension will use ${url}.`, false);
}

if (form && input && tokenInput) {
  input.placeholder = DEFAULT_DESK_URL;
  void loadDeskUrl().then((url) => {
    input.value = url;
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void save(input.value, tokenInput.value);
  });
}
