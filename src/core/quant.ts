// Motor cuantitativo (código puro, sin IA): riesgo de la cartera, Monte Carlo, pruebas de estrés,
// correlaciones, contribución al riesgo, ranking por factores y post-mortem de operaciones.
// Todo es determinista (el Monte Carlo usa una semilla), así cualquiera puede reproducirlo.
import type { DailyClose } from "./indicators";

export const TRADING_DAYS = 252;

// ---------- Utilidades estadísticas ----------

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export function covariance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (n - 1);
}

export function correlation(a: number[], b: number[]): number {
  const sa = std(a);
  const sb = std(b);
  return sa > 0 && sb > 0 ? covariance(a, b) / (sa * sb) : 0;
}

/** Percentil con interpolación lineal (q entre 0 y 1). */
export function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Generador pseudoaleatorio con semilla (mulberry32): mismos datos + misma semilla = mismo resultado. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------- Rentabilidades alineadas en EUR ----------

export interface ReturnMatrix {
  dates: string[]; // fecha de cada rentabilidad (día de cierre)
  symbols: string[];
  returns: number[][]; // returns[t][i] = rentabilidad diaria en EUR del símbolo i el día t
}

/**
 * Alinea los cierres de varios activos (bolsas con festivos distintos) en un calendario común,
 * rellenando hacia delante el último precio conocido, y convierte a EUR los activos en USD con
 * el histórico de EUR/USD. Solo se usan días en los que todos los activos ya tenían precio.
 */
export function alignReturns(
  histories: Map<string, DailyClose[]>,
  currencies: Map<string, string>,
  eurusd: DailyClose[],
  opts: { maxDays?: number; minHistory?: number } = {},
): ReturnMatrix {
  const maxDays = opts.maxDays ?? TRADING_DAYS;
  // Un activo con muy poco histórico recortaría el periodo común de todos: se descarta.
  const symbols = [...histories.keys()].filter((s) => (histories.get(s)?.length ?? 0) >= (opts.minHistory ?? 60));
  const dateSet = new Set<string>();
  for (const s of symbols) for (const h of histories.get(s)!) dateSet.add(h.date);
  const dates = [...dateSet].sort();
  const fxMap = new Map(eurusd.map((h) => [h.date, h.close]));
  const lookup = symbols.map((s) => new Map(histories.get(s)!.map((h) => [h.date, h.close])));

  const last: (number | null)[] = symbols.map(() => null);
  let lastFx: number | null = null;
  const prices: { date: string; p: (number | null)[] }[] = [];
  for (const d of dates) {
    lastFx = fxMap.get(d) ?? lastFx;
    symbols.forEach((s, i) => {
      const c = lookup[i].get(d);
      if (c !== undefined && c > 0) last[i] = c;
    });
    const p = symbols.map((s, i) => {
      if (last[i] === null) return null;
      if (currencies.get(s) === "USD") return lastFx ? last[i]! / lastFx : null;
      return last[i];
    });
    prices.push({ date: d, p });
  }
  const full = prices.filter((x) => x.p.every((v) => v !== null));
  const out: ReturnMatrix = { dates: [], symbols, returns: [] };
  for (let t = 1; t < full.length; t++) {
    out.dates.push(full[t].date);
    out.returns.push(full[t].p.map((v, i) => v! / full[t - 1].p[i]! - 1));
  }
  const cut = Math.max(0, out.dates.length - maxDays);
  out.dates = out.dates.slice(cut);
  out.returns = out.returns.slice(cut);
  return out;
}

/** Serie diaria de una cartera con pesos fijos (el resto, efectivo al 0 %). */
export function portfolioSeries(m: ReturnMatrix, weights: Record<string, number>): number[] {
  const w = m.symbols.map((s) => weights[s] ?? 0);
  return m.returns.map((row) => row.reduce((a, r, i) => a + r * w[i], 0));
}

export function column(m: ReturnMatrix, symbol: string): number[] | null {
  const i = m.symbols.indexOf(symbol);
  return i < 0 ? null : m.returns.map((r) => r[i]);
}

// ---------- Riesgo de la cartera ----------

export interface RiskStats {
  days: number;
  annReturn: number; // rentabilidad anualizada que habría tenido la cartera actual en el último año
  annVol: number;
  sharpe: number | null;
  maxDrawdown: number;
  var95_1d: number; // pérdida diaria que solo se supera 1 de cada 20 días (positiva = pérdida)
  cvar95_1d: number; // pérdida media en ese 5 % de peores días
  beta: number | null; // sensibilidad frente al benchmark
  corrBenchmark: number | null;
  trackingError: number | null;
}

export function riskStats(series: number[], bench: number[] | null, rf = 0): RiskStats {
  const annVol = std(series) * Math.sqrt(TRADING_DAYS);
  let growth = 1;
  let peak = 1;
  let mdd = 0;
  for (const r of series) {
    growth *= 1 + r;
    peak = Math.max(peak, growth);
    mdd = Math.min(mdd, growth / peak - 1);
  }
  const annReturn = series.length ? growth ** (TRADING_DAYS / series.length) - 1 : 0;
  const q5 = quantile(series, 0.05);
  const tail = series.filter((r) => r <= q5);
  const vb = bench ? std(bench) ** 2 : 0;
  return {
    days: series.length,
    annReturn,
    annVol,
    sharpe: annVol > 0 ? (annReturn - rf) / annVol : null,
    maxDrawdown: mdd,
    var95_1d: -q5,
    cvar95_1d: -mean(tail),
    beta: bench && vb > 0 ? covariance(series, bench) / vb : null,
    corrBenchmark: bench ? correlation(series, bench) : null,
    trackingError: bench ? std(series.map((r, i) => r - (bench[i] ?? 0))) * Math.sqrt(TRADING_DAYS) : null,
  };
}

/** Qué parte del riesgo total (varianza) aporta cada posición. Suma 1 si hay riesgo. */
export function riskContributions(m: ReturnMatrix, weights: Record<string, number>): { symbol: string; weight: number; contribution: number; vol: number }[] {
  const syms = m.symbols.filter((s) => (weights[s] ?? 0) > 0);
  const cols = syms.map((s) => column(m, s)!);
  const w = syms.map((s) => weights[s]);
  const cov = cols.map((a) => cols.map((b) => covariance(a, b)));
  const sw = cov.map((row) => row.reduce((acc, c, j) => acc + c * w[j], 0));
  const variance = w.reduce((acc, wi, i) => acc + wi * sw[i], 0);
  return syms
    .map((s, i) => ({ symbol: s, weight: w[i], contribution: variance > 0 ? (w[i] * sw[i]) / variance : 0, vol: std(cols[i]) * Math.sqrt(TRADING_DAYS) }))
    .sort((a, b) => b.contribution - a.contribution);
}

/** Pares de posiciones más correlacionados (se mueven juntos → diversifican poco). */
export function topCorrelations(m: ReturnMatrix, symbols: string[], n = 5): { a: string; b: string; corr: number }[] {
  const out: { a: string; b: string; corr: number }[] = [];
  for (let i = 0; i < symbols.length; i++)
    for (let j = i + 1; j < symbols.length; j++) {
      const ca = column(m, symbols[i]);
      const cb = column(m, symbols[j]);
      if (ca && cb) out.push({ a: symbols[i], b: symbols[j], corr: correlation(ca, cb) });
    }
  return out.sort((x, y) => y.corr - x.corr).slice(0, n);
}

/** Ratio de diversificación: suma de volatilidades ponderadas / volatilidad de la cartera (1 = nada diversificado). */
export function diversificationRatio(m: ReturnMatrix, weights: Record<string, number>): number | null {
  const series = portfolioSeries(m, weights);
  const pv = std(series);
  if (pv <= 0) return null;
  const sum = m.symbols.reduce((a, s) => a + (weights[s] ?? 0) * (std(column(m, s)!) || 0), 0);
  return sum / pv;
}

/** Pesos "paridad de riesgo ingenua" (inversos a la volatilidad), escalados a la parte invertida. */
export function inverseVolWeights(m: ReturnMatrix, weights: Record<string, number>): Record<string, number> {
  const syms = m.symbols.filter((s) => (weights[s] ?? 0) > 0);
  const invested = syms.reduce((a, s) => a + weights[s], 0);
  const inv = syms.map((s) => 1 / Math.max(std(column(m, s)!), 1e-6));
  const total = inv.reduce((a, b) => a + b, 0);
  return Object.fromEntries(syms.map((s, i) => [s, (inv[i] / total) * invested]));
}

// ---------- Monte Carlo ----------

/** Rentabilidad anual supuesta para la renta variable en el Monte Carlo (prudente; no es una previsión). */
export const ASSUMED_EQUITY_RETURN = 0.05;

/**
 * Quita la tendencia del último año a una serie diaria y le pone una deriva prudente. Sin esto el
 * Monte Carlo daría por hecho que lo que más subió el año pasado volverá a subir igual (sesgo de
 * selección). Así mide el riesgo (cuánto puede oscilar) con una expectativa neutral.
 */
export function neutralDrift(series: number[], annualReturn: number): number[] {
  const m = mean(series);
  const d = (1 + annualReturn) ** (1 / TRADING_DAYS) - 1;
  return series.map((r) => r - m + d);
}

export interface MonteCarloResult {
  paths: number;
  horizonDays: number;
  blockSize: number;
  seed: number;
  /** Bandas de valor (1 = valor actual) cada `step` días: p5, p25, p50, p75, p95. */
  fan: { day: number; p5: number; p25: number; p50: number; p75: number; p95: number; bench50: number | null }[];
  final: { p5: number; p25: number; p50: number; p75: number; p95: number; mean: number };
  probLoss: number;
  probLoss10: number; // probabilidad de perder más de un 10 %
  probBeatBench: number | null;
  month: { p5: number; p50: number; p95: number; probLoss: number };
}

/**
 * Monte Carlo por "bootstrap por bloques": se construyen miles de futuros posibles juntando trozos
 * de 5 días reales del último año (elegidos al azar). Mantiene las correlaciones reales entre activos
 * porque cada trozo usa los mismos días para todos, y compara con el benchmark en esos mismos días.
 */
export function monteCarlo(
  series: number[],
  bench: number[] | null,
  opts: { paths?: number; horizonDays?: number; blockSize?: number; seed: number; step?: number },
): MonteCarloResult | null {
  const n = series.length;
  const paths = opts.paths ?? 5000;
  const horizon = opts.horizonDays ?? TRADING_DAYS;
  const block = opts.blockSize ?? 5;
  const step = opts.step ?? 5;
  if (n < block * 4) return null;
  const rand = rng(opts.seed);
  const checkpoints = Math.floor(horizon / step);
  const atStep: number[][] = Array.from({ length: checkpoints + 1 }, () => new Array(paths));
  const benchAtStep: number[][] = Array.from({ length: checkpoints + 1 }, () => new Array(paths));
  const finals = new Array<number>(paths);
  const benchFinals = new Array<number>(paths);
  const month = new Array<number>(paths);
  for (let p = 0; p < paths; p++) {
    let v = 1;
    let b = 1;
    let d = 0;
    atStep[0][p] = 1;
    benchAtStep[0][p] = 1;
    while (d < horizon) {
      const start = Math.floor(rand() * (n - block + 1));
      for (let k = 0; k < block && d < horizon; k++) {
        v *= 1 + series[start + k];
        if (bench) b *= 1 + bench[start + k];
        d++;
        if (d === 21) month[p] = v;
        if (d % step === 0) {
          atStep[d / step][p] = v;
          benchAtStep[d / step][p] = b;
        }
      }
    }
    finals[p] = v;
    benchFinals[p] = b;
  }
  const fan = atStep.map((vals, i) => ({
    day: i * step,
    p5: quantile(vals, 0.05),
    p25: quantile(vals, 0.25),
    p50: quantile(vals, 0.5),
    p75: quantile(vals, 0.75),
    p95: quantile(vals, 0.95),
    bench50: bench ? quantile(benchAtStep[i], 0.5) : null,
  }));
  return {
    paths,
    horizonDays: horizon,
    blockSize: block,
    seed: opts.seed,
    fan,
    final: {
      p5: quantile(finals, 0.05),
      p25: quantile(finals, 0.25),
      p50: quantile(finals, 0.5),
      p75: quantile(finals, 0.75),
      p95: quantile(finals, 0.95),
      mean: mean(finals),
    },
    probLoss: finals.filter((v) => v < 1).length / paths,
    probLoss10: finals.filter((v) => v < 0.9).length / paths,
    probBeatBench: bench ? finals.filter((v, i) => v > benchFinals[i]).length / paths : null,
    month: { p5: quantile(month, 0.05), p50: quantile(month, 0.5), p95: quantile(month, 0.95), probLoss: month.filter((v) => v < 1).length / paths },
  };
}

// ---------- Pruebas de estrés ----------

export interface StressTest {
  name: string;
  from: string;
  to: string;
  portfolio: number; // rentabilidad que habría tenido la cartera actual
  bench: number | null;
}

/** Peor periodo de `days` sesiones del último año para el benchmark y para la cartera actual. */
export function stressTests(m: ReturnMatrix, series: number[], bench: number[] | null, days = 21): StressTest[] {
  const out: StressTest[] = [];
  const windowRet = (xs: number[], i: number) => xs.slice(i, i + days).reduce((a, r) => a * (1 + r), 1) - 1;
  const worst = (xs: number[]) => {
    let wi = 0;
    let wv = Infinity;
    for (let i = 0; i + days <= xs.length; i++) {
      const v = windowRet(xs, i);
      if (v < wv) {
        wv = v;
        wi = i;
      }
    }
    return wi;
  };
  if (series.length < days) return out;
  if (bench) {
    const i = worst(bench);
    out.push({ name: "Peor mes del benchmark en el último año", from: m.dates[i], to: m.dates[i + days - 1], portfolio: windowRet(series, i), bench: windowRet(bench, i) });
  }
  const j = worst(series);
  out.push({ name: "Peor mes de la cartera actual en el último año", from: m.dates[j], to: m.dates[j + days - 1], portfolio: windowRet(series, j), bench: bench ? windowRet(bench, j) : null });
  const k = series.indexOf(Math.min(...series));
  out.push({ name: "Peor día de la cartera actual en el último año", from: m.dates[k], to: m.dates[k], portfolio: series[k], bench: bench ? bench[k] : null });
  return out;
}

// ---------- Ranking por factores ----------

export interface FactorInput {
  symbol: string;
  ret1y: number | null;
  ret1m: number | null;
  vsSma200: number | null;
  vol3m: number | null;
  forwardPE: number | null;
}

export interface FactorScore {
  symbol: string;
  momentum: number | null; // rentabilidad 12 meses sin el último mes
  trend: number | null;
  lowVol: number | null;
  value: number | null;
  score: number; // media de los z-scores disponibles
}

function zscores(vals: (number | null)[]): (number | null)[] {
  const xs = vals.filter((v): v is number => v !== null && Number.isFinite(v));
  if (xs.length < 3) return vals.map(() => null);
  const lo = quantile(xs, 0.05);
  const hi = quantile(xs, 0.95);
  const clip = (v: number) => Math.min(hi, Math.max(lo, v));
  const m = mean(xs.map(clip));
  const s = std(xs.map(clip)) || 1;
  return vals.map((v) => (v === null || !Number.isFinite(v) ? null : (clip(v) - m) / s));
}

/** Factores clásicos: momentum, tendencia, baja volatilidad y valor (inverso del PER futuro). */
export function factorScores(rows: FactorInput[]): FactorScore[] {
  const mom = rows.map((r) => (r.ret1y !== null && r.ret1m !== null ? (1 + r.ret1y) / (1 + r.ret1m) - 1 : null));
  const trend = rows.map((r) => r.vsSma200);
  const lowVol = rows.map((r) => (r.vol3m !== null ? -r.vol3m : null));
  const value = rows.map((r) => (r.forwardPE !== null && r.forwardPE > 0 ? 1 / r.forwardPE : null));
  const z = [zscores(mom), zscores(trend), zscores(lowVol), zscores(value)];
  return rows
    .map((r, i) => {
      const parts = z.map((col) => col[i]).filter((v): v is number => v !== null);
      return { symbol: r.symbol, momentum: z[0][i], trend: z[1][i], lowVol: z[2][i], value: z[3][i], score: parts.length >= 2 ? mean(parts) : -Infinity };
    })
    .sort((a, b) => b.score - a.score);
}

// ---------- Post-mortem ----------

export interface TradeReview {
  symbol: string;
  side: "buy" | "sell";
  at: string;
  priceEur: number; // precio de ejecución en EUR (con slippage)
  nowEur: number | null; // precio actual en EUR
  ret: number | null; // rentabilidad desde la operación (para ventas: lo que se evitó/perdió)
  benchRet: number | null; // rentabilidad del benchmark en el mismo periodo
  excess: number | null; // compras: ret − benchRet; ventas: benchRet − ret (positivo = acierto)
  days: number;
}

/**
 * Evalúa cada operación pasada: cuánto ha hecho el activo desde entonces frente al benchmark.
 * Para una compra, acertar = el activo lo hizo mejor que el benchmark. Para una venta, acertar =
 * el activo vendido lo hizo peor que el benchmark después de venderlo.
 */
export function reviewTrades(
  trades: { symbol: string; side: "buy" | "sell"; at: Date; priceEur: number }[],
  nowPriceEur: Map<string, number>,
  benchAt: (d: Date) => number | null,
  benchNow: number | null,
  now: Date,
): { trades: TradeReview[]; hitRate: number | null; avgExcess: number | null } {
  const out: TradeReview[] = trades.map((t) => {
    const p = nowPriceEur.get(t.symbol) ?? null;
    const b0 = benchAt(t.at);
    const ret = p !== null && t.priceEur > 0 ? p / t.priceEur - 1 : null;
    const benchRet = b0 && benchNow ? benchNow / b0 - 1 : null;
    const excess = ret === null || benchRet === null ? null : t.side === "buy" ? ret - benchRet : benchRet - ret;
    return { symbol: t.symbol, side: t.side, at: t.at.toISOString(), priceEur: t.priceEur, nowEur: p, ret, benchRet, excess, days: Math.round((now.getTime() - t.at.getTime()) / 86_400_000) };
  });
  const judged = out.filter((t) => t.excess !== null);
  return {
    trades: out,
    hitRate: judged.length ? judged.filter((t) => t.excess! > 0).length / judged.length : null,
    avgExcess: judged.length ? mean(judged.map((t) => t.excess!)) : null,
  };
}
