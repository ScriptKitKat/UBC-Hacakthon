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
};

const PRICE_TITLE = /^([A-Za-z0-9]+(?:\s+[A-Za-z0-9]+){0,3})\s+price(?:\s+on\s+.+|\s+today\??|\s+tomorrow\??)?\??$/iu;

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
  return `${assetDisplayName(match[1] ?? eventTitle)} price ${relativePriceDay(expiry, now, timeZone)}`;
}

export function formatDeadline(expiryDate: string | null | undefined, timeZone?: string): string | null {
  if (!expiryDate) return null;
  const date = new Date(expiryDate);
  if (!Number.isFinite(date.getTime())) return null;
  return `Closes ${new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date)}`;
}
