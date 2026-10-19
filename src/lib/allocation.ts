// Reparto de la cartera por zona geográfica y por tipo de activo (para la página Explicaciones).

// Zona de cada ETF del universo (las acciones usan la región de su ficha).
const ETF_ZONE: Record<string, string> = {
  SPY: "EE. UU.", QQQ: "EE. UU.", SMH: "EE. UU.", XLE: "EE. UU.", XLV: "EE. UU.", XLF: "EE. UU.", "SXR8.DE": "EE. UU.",
  "IWDA.AS": "Global (países desarrollados)", "SXRT.DE": "Europa", "EXS1.DE": "Europa",
  VWO: "Emergentes (varios)", EEM: "Emergentes (varios)", "IS3N.DE": "Emergentes (varios)",
  FXI: "China", MCHI: "China", KWEB: "China", GXC: "China", INDA: "India", EWZ: "Brasil", EWT: "Taiwán",
  EWY: "Corea", EWJ: "Japón", EWW: "México", ARGT: "Argentina", ECH: "Andes y Centroamérica",
  EPOL: "Europa", TUR: "Turquía", EIDO: "Sudeste asiático", VNM: "Sudeste asiático", THD: "Sudeste asiático",
  EPHE: "Sudeste asiático", KSA: "Oriente Medio",
  TLT: "Bonos EE. UU.", IEF: "Bonos EE. UU.", SHY: "Bonos EE. UU.", "EUNH.DE": "Bonos europeos",
  GLD: "Oro (sin país)", "4GLD.DE": "Oro (sin país)", "XEON.DE": "Liquidez en euros",
};
const DEFENSIVE = new Set(["TLT", "IEF", "SHY", "EUNH.DE", "GLD", "4GLD.DE", "XEON.DE"]);

export interface Slice {
  label: string;
  valueEur: number;
  share: number;
  symbols: string[];
}

interface Holding {
  symbol: string;
  valueEur: number;
  currency?: string;
}

function group(items: { key: string; symbol: string; value: number }[], total: number): Slice[] {
  const m = new Map<string, Slice>();
  for (const it of items) {
    const s = m.get(it.key) ?? { label: it.key, valueEur: 0, share: 0, symbols: [] };
    s.valueEur += it.value;
    if (it.symbol) s.symbols.push(it.symbol);
    m.set(it.key, s);
  }
  return [...m.values()].map((s) => ({ ...s, share: total > 0 ? s.valueEur / total : 0 })).sort((a, b) => b.valueEur - a.valueEur);
}

export function allocation(holdings: Holding[], cashEur: number, instruments: Map<string, { kind?: string; region?: string | null }>) {
  const total = cashEur + holdings.reduce((a, h) => a + Number(h.valueEur), 0);
  const cash = { symbol: "", value: cashEur };
  const zone = (s: string) => ETF_ZONE[s] ?? instruments.get(s)?.region ?? "Otros";
  const type = (s: string) => (DEFENSIVE.has(s) ? "Oro, bonos y liquidez" : instruments.get(s)?.kind === "etf" ? "Fondos (ETF): cestas de muchas empresas" : "Acciones de empresas concretas");
  return {
    total,
    byZone: group([...holdings.map((h) => ({ key: zone(h.symbol), symbol: h.symbol, value: Number(h.valueEur) })), { key: "Efectivo", ...cash }], total),
    byType: group([...holdings.map((h) => ({ key: type(h.symbol), symbol: h.symbol, value: Number(h.valueEur) })), { key: "Efectivo", ...cash }], total),
    usdShare: total > 0 ? holdings.filter((h) => h.currency === "USD").reduce((a, h) => a + Number(h.valueEur), 0) / total : 0,
  };
}
