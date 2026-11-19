import { describe, expect, it } from "vitest";
import { parseInstrumentSymbol } from "./symbol";

describe("parseInstrumentSymbol", () => {
  it("splits a simple symbol", () => {
    expect(parseInstrumentSymbol("GEMI-FED261211-MAINTAIN")).toEqual({ eventTicker: "FED261211", contractTicker: "MAINTAIN" });
  });

  it("keeps hyphens inside the event ticker", () => {
    expect(parseInstrumentSymbol("GEMI-NBA-2611190030-CHI-BKN-S-CHI27")).toEqual({
      eventTicker: "NBA-2611190030-CHI-BKN-S",
      contractTicker: "CHI27",
    });
  });

  it.each(["", "FED261211-MAINTAIN", "GEMI-FED261211", "GEMI--MAINTAIN", "GEMI-fed-maintain", "GEMI-FED/../x-Y", "GEMI-FED261211-MAINTAIN?x=1", "../GEMI-A-B"])(
    "rejects %j",
    (symbol) => {
      expect(parseInstrumentSymbol(symbol)).toBeUndefined();
    },
  );
});
