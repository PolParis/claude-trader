// Benchmarks: una sola compra el día 1 con el mismo capital y los mismos costes
// (comisión, slippage, unidades enteras). Lo que sobra queda en efectivo.
import { commissionEur, slippedPrice } from "./fees";
import { eur } from "./money";
import type { Currency, ExperimentConfig, MarketId } from "./types";

export interface BenchmarkDef {
  code: string;
  name: string;
  symbol: string | null; // null = efectivo
  market: MarketId | null;
  currency: Currency;
  color: string;
}

export const BENCHMARKS: BenchmarkDef[] = [
  { code: "MSCI_WORLD", name: "MSCI World (IWDA)", symbol: "IWDA.AS", market: "EURONEXT", currency: "EUR", color: "#2a9d8f" },
  { code: "SP500", name: "S&P 500 (SXR8)", symbol: "SXR8.DE", market: "XETRA", currency: "EUR", color: "#e76f51" },
  { code: "EUROSTOXX50", name: "Euro Stoxx 50 (SXRT)", symbol: "SXRT.DE", market: "XETRA", currency: "EUR", color: "#8e7dbe" },
  { code: "CASH", name: "Efectivo", symbol: null, market: null, currency: "EUR", color: "#9ca3af" },
];

export interface BenchmarkPosition {
  code: string;
  units: number;
  buyPriceLocal: number;
  fxRate: number;
  grossEur: number;
  commissionEur: number;
  cashLeftEur: number;
}

export function initBenchmark(code: string, capital: number, priceLocal: number | null, fxRate: number, cfg: ExperimentConfig): BenchmarkPosition {
  if (priceLocal === null) {
    return { code, units: 0, buyPriceLocal: 0, fxRate: 1, grossEur: 0, commissionEur: 0, cashLeftEur: eur(capital) };
  }
  const fill = slippedPrice(priceLocal, "buy", cfg);
  const unitEur = fill / fxRate;
  let units = Math.floor(capital / unitEur);
  const cost = (u: number) => {
    const gross = eur(u * unitEur);
    return { gross, commission: commissionEur(gross, cfg) };
  };
  while (units > 0 && cost(units).gross + cost(units).commission > capital) units--;
  const { gross, commission } = cost(units);
  return {
    code,
    units,
    buyPriceLocal: fill,
    fxRate,
    grossEur: units > 0 ? gross : 0,
    commissionEur: units > 0 ? commission : 0,
    cashLeftEur: units > 0 ? eur(capital - gross - commission) : eur(capital),
  };
}

export function benchmarkValueEur(b: Pick<BenchmarkPosition, "units" | "cashLeftEur">, priceLocal: number | null, fxRate = 1): number {
  if (!b.units || priceLocal === null) return eur(b.cashLeftEur);
  return eur((b.units * priceLocal) / fxRate + b.cashLeftEur);
}
