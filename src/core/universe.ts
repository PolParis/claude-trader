// Universo base: valores y ETFs líquidos cotizados en EUR o USD. La exposición a China,
// India, LatAm, Asia y emergentes se consigue con ADRs y ETFs de país. Claude puede añadir
// más tickers a su watchlist (se validan bolsa y divisa con datos reales antes de aceptarlos).

export interface UniverseEntry {
  symbol: string;
  region: string;
}

const g = (region: string, symbols: string[]): UniverseEntry[] => symbols.map((symbol) => ({ symbol, region }));

export const BASE_UNIVERSE: UniverseEntry[] = [
  ...g("EE. UU.", [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "AVGO", "TSLA", "BRK-B", "JPM",
    "V", "MA", "LLY", "UNH", "JNJ", "XOM", "PG", "KO", "COST", "WMT",
    "NFLX", "AMD", "ORCL", "CRM", "PLTR", "CAT", "GE", "MRK", "ABBV", "BAC",
  ]),
  ...g("Europa", [
    "ASML.AS", "SAP.DE", "SIE.DE", "ALV.DE", "DTE.DE", "RHM.DE", "IFX.DE", "MUV2.DE",
    "MC.PA", "OR.PA", "TTE.PA", "SAN.PA", "AIR.PA", "SU.PA", "BNP.PA", "RMS.PA",
    "ITX.MC", "SAN.MC", "IBE.MC", "BBVA.MC", "ADYEN.AS", "INGA.AS", "PRX.AS", "ABI.BR",
  ]),
  ...g("China", [
    "BABA", "PDD", "JD", "BIDU", "NTES", "TCOM", "BILI", "LI", "NIO", "XPEV",
    "BEKE", "YUMC", "ZTO", "TME", "FUTU", "TAL", "EDU", "VIPS", "HTHT",
  ]),
  ...g("Taiwán", ["TSM", "UMC", "ASX"]),
  ...g("Corea", ["CPNG", "KB", "SHG", "PKX"]),
  ...g("Japón", ["SONY", "TM", "HMC", "MUFG", "SMFG", "NMR"]),
  ...g("India", ["INFY", "IBN", "HDB", "WIT", "RDY", "MMYT"]),
  ...g("Brasil", ["NU", "VALE", "PBR", "ITUB", "BBD", "XP", "STNE", "PAGS", "SBS"]),
  ...g("México", ["AMX", "FMX", "CX", "KOF"]),
  ...g("Argentina", ["MELI", "YPF", "GGAL", "VIST", "BMA"]),
  ...g("Andes y Centroamérica", ["SQM", "CIB", "BAP", "CPA"]),
  ...g("Israel", ["TEVA", "CHKP"]),
  ...g("Sudáfrica (oro)", ["GFI", "AU", "HMY"]),
  ...g("Sudeste asiático", ["SE", "GRAB"]),
  ...g("ETF EE. UU.", ["SPY", "QQQ", "SMH", "XLE", "XLV", "XLF"]),
  ...g("ETF emergentes y países", [
    "VWO", "EEM", "FXI", "MCHI", "KWEB", "GXC", "INDA", "EWZ", "EWT", "EWY", "EWJ", "EWW",
    "ARGT", "ECH", "EPOL", "TUR", "EIDO", "VNM", "THD", "EPHE", "KSA", "IS3N.DE",
  ]),
  ...g("ETF Europa/global (EUR)", ["IWDA.AS", "SXR8.DE", "SXRT.DE", "EXS1.DE"]),
  ...g("Renta fija, oro y liquidez", ["TLT", "IEF", "SHY", "GLD", "EUNH.DE", "4GLD.DE", "XEON.DE"]),
];

/** Contexto de mercado (no operable): índices, volatilidad, tipos y divisas. */
export const MARKET_CONTEXT: { symbol: string; label: string }[] = [
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "^IXIC", label: "Nasdaq Composite" },
  { symbol: "^STOXX50E", label: "Euro Stoxx 50" },
  { symbol: "^GDAXI", label: "DAX" },
  { symbol: "^IBEX", label: "IBEX 35" },
  { symbol: "^HSI", label: "Hang Seng" },
  { symbol: "000001.SS", label: "Shanghái Composite" },
  { symbol: "^NSEI", label: "Nifty 50 (India)" },
  { symbol: "^N225", label: "Nikkei 225" },
  { symbol: "^VIX", label: "VIX (volatilidad)" },
  { symbol: "^TNX", label: "Bono EE. UU. 10 años (%)" },
  { symbol: "GC=F", label: "Oro (futuro)" },
  { symbol: "CL=F", label: "Petróleo WTI (futuro)" },
  { symbol: "EURUSD=X", label: "EUR/USD" },
];

export const MAX_WATCHLIST_EXTRA = 20;
