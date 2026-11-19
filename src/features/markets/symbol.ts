const SYMBOL_PATTERN = /^GEMI-([A-Z0-9]+(?:-[A-Z0-9]+)*)-([A-Z0-9]+)$/u;

export interface ParsedSymbol {
  readonly eventTicker: string;
  readonly contractTicker: string;
}

export function parseInstrumentSymbol(symbol: string): ParsedSymbol | undefined {
  const match = SYMBOL_PATTERN.exec(symbol);
  const eventTicker = match?.[1];
  const contractTicker = match?.[2];
  return eventTicker === undefined || contractTicker === undefined ? undefined : { eventTicker, contractTicker };
}
