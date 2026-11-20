const ASSET_NAMES: Readonly<Record<string, string>> = {
  BTC: "Bitcoin",
  BITCOIN: "Bitcoin",
  ETH: "Ethereum",
  ETHEREUM: "Ethereum",
  SOL: "Solana",
  SOLANA: "Solana",
  XRP: "XRP",
  DOGE: "Dogecoin",
  DOGECOIN: "Dogecoin",
  ADA: "Cardano",
  CARDANO: "Cardano",
  AVAX: "Avalanche",
  AVALANCHE: "Avalanche",
  DOT: "Polkadot",
  POLKADOT: "Polkadot",
  LINK: "Chainlink",
  CHAINLINK: "Chainlink",
  MATIC: "Polygon",
  POL: "Polygon",
  POLYGON: "Polygon",
  LTC: "Litecoin",
  LITECOIN: "Litecoin",
  BCH: "Bitcoin Cash",
  UNI: "Uniswap",
  ATOM: "Cosmos",
  FIL: "Filecoin",
  APT: "Aptos",
  SUI: "Sui",
  ARB: "Arbitrum",
  OP: "Optimism",
  NEAR: "Near",
  TON: "Toncoin",
  TRX: "TRON",
  SHIB: "Shiba Inu",
  PEPE: "Pepe",
  BNB: "BNB",
  AAVE: "Aave",
  MKR: "Maker",
  XLM: "Stellar",
  HYPE: "Hyperliquid",
  ZEC: "Zcash",
  ZCASH: "Zcash",
  ETHER: "Ethereum",
  WETH: "Ethereum",
  STETH: "Lido Staked Ether",
  WBTC: "Wrapped Bitcoin",
  CRO: "Cronos",
  ETC: "Ethereum Classic",
  XMR: "Monero",
  DASH: "Dash",
  XTZ: "Tezos",
  ALGO: "Algorand",
  VET: "VeChain",
  EOS: "EOS",
  KAS: "Kaspa",
  INJ: "Injective",
  TIA: "Celestia",
  SEI: "Sei",
  FET: "Fetch",
  GRT: "The Graph",
  LDO: "Lido",
  IMX: "Immutable",
  STX: "Stacks",
  RUNE: "THORChain",
  SAND: "The Sandbox",
  MANA: "Decentraland",
  APE: "ApeCoin",
  CRV: "Curve",
  ENS: "ENS",
  COMP: "Compound",
  SNX: "Synthetix",
  YFI: "Yearn",
  ENA: "Ethena",
  ONDO: "Ondo",
  JUP: "Jupiter",
  PYTH: "Pyth",
  PENDLE: "Pendle",
  WIF: "dogwifhat",
  BONK: "Bonk",
  FLOKI: "FLOKI",
  RENDER: "Render",
  AR: "Arweave",
  TRUMP: "Official Trump",
  WLD: "Worldcoin",
  BLUR: "Blur",
  STRK: "Starknet",
  ZK: "ZKsync",
  TUSD: "TrueUSD",
  USDC: "USD Coin",
  USDT: "Tether",
  DAI: "Dai",
};

const PRICE_TITLE = /^([A-Za-z0-9]+(?:\s+[A-Za-z0-9]+){0,3})\s+price(?:\s+on\s+.+|\s+today(?:\s+at\s+.+)?|\s+tomorrow(?:\s+at\s+.+)?)?\??$/iu;

const ASSET_TICKERS: ReadonlyMap<string, string> = Object.entries(ASSET_NAMES).reduce((tickers, [ticker, name]) => {
  const key = name.toUpperCase();
  if (ticker !== key && !tickers.has(key)) tickers.set(key, ticker);
  return tickers;
}, new Map<string, string>());

const LONGEST_ASSET_WORDS = Math.max(...[...ASSET_TICKERS.keys()].map((name) => name.split(" ").length));

function leadingAsset(words: readonly string[]): { readonly ticker: string; readonly length: number } | null {
  for (let length = Math.min(LONGEST_ASSET_WORDS, words.length); length > 0; length -= 1) {
    const ticker = ASSET_TICKERS.get(words.slice(0, length).join(" ").toUpperCase());
    if (ticker !== undefined) return { ticker, length };
  }
  return null;
}

export function marketSearchTerm(search: string): string {
  const words = search.trim().split(/\s+/u);
  const terms: string[] = [];
  for (let index = 0; index < words.length;) {
    const asset = leadingAsset(words.slice(index));
    terms.push(asset?.ticker ?? words[index] ?? "");
    index += asset?.length ?? 1;
  }
  return terms.join(" ");
}

export function assetDisplayName(token: string): string {
  return ASSET_NAMES[token.toUpperCase()] ?? token;
}

function ymd(date: Date, timeZone?: string): readonly [number, number, number] {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return [value("year"), value("month"), value("day")];
}

function dayIndex(date: Date, timeZone?: string): number {
  const [year, month, day] = ymd(date, timeZone);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

export function relativePriceDay(expiry: Date, now = new Date(), timeZone?: string): string {
  const diff = dayIndex(expiry, timeZone) - dayIndex(now, timeZone);
  if (diff === 0) return "today?";
  if (diff === 1) return "tomorrow?";
  return `on ${new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(expiry)}?`;
}

export function friendlyEventTitle(
  eventTitle: string,
  expiryDate: string | null | undefined,
  now = new Date(),
  timeZone?: string,
): string {
  const match = PRICE_TITLE.exec(eventTitle.trim());
  if (match === null) return eventTitle;
  const expiry = expiryDate === undefined || expiryDate === null || expiryDate === "" ? undefined : new Date(expiryDate);
  if (expiry === undefined || !Number.isFinite(expiry.getTime())) return eventTitle;
  const base = `${assetDisplayName(match[1] ?? eventTitle)} price ${relativePriceDay(expiry, now, timeZone)}`;
  const timeAt = /\bat\s+(.+?)\??$/iu.exec(eventTitle.trim());
  if (timeAt?.[1] === undefined) return base;
  return base.replace(/\?$/u, ` at ${timeAt[1].replace(/\?+$/u, "")}?`);
}

export function formatDeadline(expiryDate: string | null | undefined, timeZone?: string): string | null {
  if (!expiryDate) return null;
  const date = new Date(expiryDate);
  if (!Number.isFinite(date.getTime())) return null;
  return `Closes ${new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date)}`;
}

export function formatMarketWhen(expiryDate: string | null | undefined, now = new Date(), timeZone = "America/Chicago"): string | null {
  if (!expiryDate) return null;
  const expiry = new Date(expiryDate);
  if (!Number.isFinite(expiry.getTime())) return null;
  const expiryDay = dayIndex(expiry, timeZone);
  const today = dayIndex(now, timeZone);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(expiry);
  const diff = expiryDay - today;
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Tomorrow, ${time}`;
  if (diff > 1 && diff < 7) {
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(expiry);
    return `Ends ${weekday}`;
  }
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(expiry);
}

export function formatEndsOn(expiryDate: string | null | undefined, timeZone = "America/Chicago"): string | null {
  if (!expiryDate) return null;
  const date = new Date(expiryDate);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(date);
}

export interface OutcomeSides {
  readonly yes: string;
  readonly no: string;
}

const MATCHUP = /^(.+?)\s+(?:vs\.?|v\.?|@|at)\s+(.+)$/iu;

export function outcomeSides(eventTitle: string, contractLabel: string): OutcomeSides {
  const teams = MATCHUP.exec(eventTitle.trim())?.slice(1, 3).map((team) => team.trim());
  const picked = contractLabel.trim().toLowerCase();
  const index = teams?.findIndex((team) => team.toLowerCase() === picked) ?? -1;
  const winner = teams?.[index];
  const loser = teams?.[1 - index];
  if (index === -1 || winner === undefined || loser === undefined) return { yes: "Yes", no: "No" };
  return { yes: `${winner} wins`, no: `${loser} wins` };
}
