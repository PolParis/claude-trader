// Métricas de rendimiento a partir de la serie de valores de cierre diario.
import type { ClosedTrade } from "./portfolio";

export interface SeriesPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface Drawdown {
  pct: number; // negativo, p. ej. -0.12
  peakDate: string | null;
  troughDate: string | null;
}

export function dailyReturns(series: SeriesPoint[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < series.length; i++) r.push(series[i].value / series[i - 1].value - 1);
  return r;
}

function mean(xs: number[]) {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
function stdev(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function totalReturn(initial: number, current: number): number {
  return current / initial - 1;
}

/** Rentabilidad anualizada; null si el periodo es menor de `minDays` (no tiene sentido anualizar). */
export function annualizedReturn(initial: number, current: number, days: number, minDays = 30): number | null {
  if (days < minDays) return null;
  return (current / initial) ** (365 / days) - 1;
}

export function annualizedVolatility(series: SeriesPoint[]): number | null {
  const r = dailyReturns(series);
  if (r.length < 2) return null;
  return stdev(r) * Math.sqrt(252);
}

export function sharpeRatio(series: SeriesPoint[], riskFreeRate: number): number | null {
  const r = dailyReturns(series);
  if (r.length < 2) return null;
  const sd = stdev(r);
  if (sd === 0) return null;
  return ((mean(r) - riskFreeRate / 252) / sd) * Math.sqrt(252);
}

export function maxDrawdown(series: SeriesPoint[]): Drawdown {
  let peak = -Infinity;
  let peakDate: string | null = null;
  let worst: Drawdown = { pct: 0, peakDate: null, troughDate: null };
  for (const p of series) {
    if (p.value > peak) {
      peak = p.value;
      peakDate = p.date;
    }
    const dd = p.value / peak - 1;
    if (dd < worst.pct) worst = { pct: dd, peakDate, troughDate: p.date };
  }
  return worst;
}

export function winRate(trades: ClosedTrade[]): number | null {
  if (!trades.length) return null;
  return trades.filter((t) => t.pnlEur > 0).length / trades.length;
}

/** Rotación: la mitad de lo negociado (compras + ventas) dividida entre el valor medio de la cartera. */
export function turnover(turnoverEur: number, series: SeriesPoint[]): number | null {
  if (!series.length) return null;
  const avg = mean(series.map((p) => p.value));
  return avg > 0 ? turnoverEur / 2 / avg : null;
}

export function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 86_400_000;
}
