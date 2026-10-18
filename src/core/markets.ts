import type { MarketId } from "./types";

// Códigos de bolsa de Yahoo Finance → mercado permitido. Cualquier otro (OTC, Londres,
// Fráncfort parqué, Milán...) no está en el universo permitido.
const YAHOO_EXCHANGES: Record<string, MarketId> = {
  NMS: "US", // Nasdaq Global Select
  NGM: "US", // Nasdaq Global Market
  NCM: "US", // Nasdaq Capital Market
  NYQ: "US", // NYSE
  ASE: "US", // NYSE American
  PCX: "US", // NYSE Arca
  BTS: "US", // Cboe BZX
  GER: "XETRA",
  PAR: "EURONEXT",
  AMS: "EURONEXT",
  BRU: "EURONEXT",
  LIS: "EURONEXT",
  MCE: "BME",
  CCC: "CRYPTO",
};

export function marketFromYahooExchange(code: string | undefined | null): MarketId | null {
  return (code && YAHOO_EXCHANGES[code]) || null;
}

export const ALLOWED_CURRENCIES = ["EUR", "USD"] as const;
