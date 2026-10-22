// Informe cuantitativo de cada ejecución (código, sin IA): lo leen los agentes y se guarda para la web.
import type { DailyClose } from "@/core/indicators";
import {
  alignReturns,
  column,
  diversificationRatio,
  factorScores,
  inverseVolWeights,
  monteCarlo,
  neutralDrift,
  ASSUMED_EQUITY_RETURN,
  portfolioSeries,
  reviewTrades,
  riskContributions,
  riskStats,
  seedFrom,
  stressTests,
  topCorrelations,
  type FactorScore,
  type MonteCarloResult,
  type RiskStats,
  type StressTest,
  type TradeReview,
} from "@/core/quant";
import type { LedgerEvent } from "@/core/types";
import type { MarketSnapshot } from "./market-data";
import type { MarketDataProvider } from "./market/provider";
import { FX_SYMBOL } from "./ops";

export const QUANT_BENCHMARK = { symbol: "IWDA.AS", name: "MSCI World" };

export interface QuantReport {
  generatedAt: string;
  benchmark: { symbol: string; name: string };
  days: number;
  weights: Record<string, number>;
  cashWeight: number;
  risk: RiskStats | null;
  benchRisk: RiskStats | null;
  riskContributions: { symbol: string; weight: number; contribution: number; vol: number }[];
  topCorrelations: { a: string; b: string; corr: number }[];
  diversificationRatio: number | null;
  inverseVolWeights: Record<string, number>;
  monteCarlo: MonteCarloResult | null;
  stress: StressTest[];
  factors: (FactorScore & { name: string; region: string; held: boolean })[];
  postmortem: { trades: TradeReview[]; hitRate: number | null; avgExcess: number | null };
}

export async function buildQuantReport(args: {
  market: MarketSnapshot;
  provider: MarketDataProvider;
  holdings: { symbol: string; valueEur: number }[];
  totalEur: number;
  events: LedgerEvent[];
  now: Date;
  log: (m: string) => void;
}): Promise<QuantReport> {
  const { market, holdings, totalEur, now } = args;
  const weights = Object.fromEntries(holdings.map((h) => [h.symbol, h.valueEur / totalEur]));
  const cashWeight = 1 - Object.values(weights).reduce((a, b) => a + b, 0);
  let eurusd: DailyClose[] = [];
  try {
    eurusd = await args.provider.getDailyHistory(FX_SYMBOL, new Date(now.getTime() - 400 * 86_400_000));
  } catch (e) {
    args.log(`Cuant: sin histórico EUR/USD (${(e as Error).message}); los activos en USD se tratan sin conversión.`);
  }
  const currencies = new Map([...market.quotes].map(([s, q]) => [s, q.currency]));

  // Matriz de rentabilidades de lo que se tiene + benchmark (periodo común).
  const relevant = new Map<string, DailyClose[]>();
  for (const s of [...Object.keys(weights), QUANT_BENCHMARK.symbol]) {
    const h = market.histories.get(s);
    if (h) relevant.set(s, h);
  }
  const m = alignReturns(relevant, currencies, eurusd);
  const missing = Object.keys(weights).filter((s) => !m.symbols.includes(s));
  if (missing.length) args.log(`Cuant: sin histórico suficiente para ${missing.join(", ")} (fuera del cálculo de riesgo).`);
  const series = portfolioSeries(m, weights);
  const bench = column(m, QUANT_BENCHMARK.symbol);
  const held = Object.keys(weights).filter((s) => m.symbols.includes(s));

  const factors = factorScores(
    market.universe.map((u) => ({
      symbol: u.quote.symbol,
      ret1y: u.indicators?.ret1y ?? null,
      ret1m: u.indicators?.ret1m ?? null,
      vsSma200: u.indicators?.vsSma200 ?? null,
      vol3m: u.indicators?.vol3m ?? null,
      forwardPE: u.quote.forwardPE,
    })),
  )
    .filter((f) => Number.isFinite(f.score))
    .map((f) => {
      const u = market.universe.find((x) => x.quote.symbol === f.symbol)!;
      return { ...f, name: u.quote.name, region: u.region, held: u.held };
    });

  // Post-mortem: cada operación de Claude frente al benchmark desde ese momento.
  const fx = market.quotes.get(FX_SYMBOL)?.price ?? null;
  const priceEur = new Map<string, number>();
  for (const [s, q] of market.quotes) {
    if (q.currency === "EUR") priceEur.set(s, q.price);
    else if (q.currency === "USD" && fx) priceEur.set(s, q.price / fx);
  }
  const benchHist = market.histories.get(QUANT_BENCHMARK.symbol) ?? [];
  const benchAt = (d: Date) => {
    const day = d.toISOString().slice(0, 10);
    const row = [...benchHist].reverse().find((h) => h.date <= day);
    return row?.close ?? benchHist[0]?.close ?? null;
  };
  const trades = args.events.flatMap((e) =>
    e.type === "fill" ? [{ symbol: e.fill.symbol, side: e.fill.side, at: e.fill.executedAt, priceEur: e.fill.priceLocal / (e.fill.fxRate || 1) }] : [],
  );
  const postmortem = reviewTrades(trades, priceEur, benchAt, market.quotes.get(QUANT_BENCHMARK.symbol)?.price ?? null, now);

  return {
    generatedAt: now.toISOString(),
    benchmark: QUANT_BENCHMARK,
    days: m.dates.length,
    weights,
    cashWeight,
    risk: series.length ? riskStats(series, bench) : null,
    benchRisk: bench ? riskStats(bench, bench) : null,
    riskContributions: riskContributions(m, weights),
    topCorrelations: topCorrelations(m, held, 5),
    diversificationRatio: diversificationRatio(m, weights),
    inverseVolWeights: inverseVolWeights(m, weights),
    // Deriva neutral: la parte invertida espera lo mismo que la bolsa (supuesto prudente), el efectivo 0 %.
    monteCarlo: series.length
      ? monteCarlo(neutralDrift(series, ASSUMED_EQUITY_RETURN * (1 - cashWeight)), bench ? neutralDrift(bench, ASSUMED_EQUITY_RETURN) : null, {
          seed: seedFrom(now.toISOString().slice(0, 13)),
          paths: 5000,
          horizonDays: 252,
          step: 5,
        })
      : null,
    stress: stressTests(m, series, bench, 21),
    factors,
    postmortem,
  };
}

const p = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? "?" : `${(x * 100).toFixed(d)} %`);
const n2 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "?" : x.toFixed(2));

/** Versión en texto compacto para los prompts de los agentes. */
export function quantReportText(r: QuantReport, opts: { factors?: number } = {}): string {
  const L: string[] = [];
  L.push(`Periodo de cálculo: últimas ${r.days} sesiones, en EUR. Benchmark: ${r.benchmark.name} (${r.benchmark.symbol}). Peso en efectivo: ${p(r.cashWeight)}.`);
  if (r.risk && r.benchRisk) {
    const a = r.risk;
    const b = r.benchRisk;
    L.push("Riesgo de la cartera ACTUAL si se hubiera tenido todo el último año (cartera | benchmark):");
    L.push(`- Rentabilidad anualizada: ${p(a.annReturn)} | ${p(b.annReturn)}; volatilidad: ${p(a.annVol)} | ${p(b.annVol)}; Sharpe: ${n2(a.sharpe)} | ${n2(b.sharpe)}`);
    L.push(`- Máxima caída: ${p(a.maxDrawdown)} | ${p(b.maxDrawdown)}; VaR 95 % 1 día: ${p(a.var95_1d, 2)} | ${p(b.var95_1d, 2)}; CVaR 95 %: ${p(a.cvar95_1d, 2)} | ${p(b.cvar95_1d, 2)}`);
    L.push(`- Beta frente al benchmark: ${n2(a.beta)}; correlación: ${n2(a.corrBenchmark)}; tracking error: ${p(a.trackingError)}; ratio de diversificación: ${n2(r.diversificationRatio)}`);
  }
  if (r.monteCarlo) {
    const mc = r.monteCarlo;
    L.push(`Monte Carlo (${mc.paths} escenarios, bootstrap por bloques de ${mc.blockSize} días, semilla ${mc.seed}). Mide RIESGO, no predice: se quita la tendencia del último año y se supone un ${p(ASSUMED_EQUITY_RETURN, 0)} anual para la bolsa (efectivo 0 %):`);
    L.push(`- A 1 mes: p5 ${p(mc.month.p5 - 1)}, mediana ${p(mc.month.p50 - 1)}, p95 ${p(mc.month.p95 - 1)}; prob. de pérdida ${p(mc.month.probLoss, 0)}`);
    L.push(`- A 1 año: p5 ${p(mc.final.p5 - 1)}, mediana ${p(mc.final.p50 - 1)}, p95 ${p(mc.final.p95 - 1)}; prob. de pérdida ${p(mc.probLoss, 0)}; prob. de perder >10 % ${p(mc.probLoss10, 0)}; prob. de batir al benchmark ${p(mc.probBeatBench, 0)}`);
  }
  if (r.stress.length) {
    L.push("Pruebas de estrés (cartera actual | benchmark):");
    for (const s of r.stress) L.push(`- ${s.name} (${s.from} → ${s.to}): ${p(s.portfolio)} | ${p(s.bench)}`);
  }
  if (r.riskContributions.length) {
    L.push("Contribución al riesgo (símbolo: peso → % del riesgo total, volatilidad anual; ideal inverso a la vol.):");
    for (const c of r.riskContributions) L.push(`- ${c.symbol}: ${p(c.weight)} → ${p(c.contribution)} (vol ${p(c.vol, 0)}; peso paridad de riesgo ${p(r.inverseVolWeights[c.symbol])})`);
  }
  if (r.topCorrelations.length) L.push(`Pares más correlacionados: ${r.topCorrelations.map((c) => `${c.a}/${c.b} ${n2(c.corr)}`).join(", ")}`);
  const top = r.factors.slice(0, opts.factors ?? 20);
  if (top.length) {
    L.push(`Ranking por factores del universo (z-scores; mom = momentum 12-1 meses, tend = vs media 200, bajaVol, valor = 1/PER futuro). Top ${top.length}:`);
    L.push("símbolo;región;score;mom;tend;bajaVol;valor;en_cartera");
    for (const f of top) L.push(`${f.symbol};${f.region};${n2(f.score)};${n2(f.momentum)};${n2(f.trend)};${n2(f.lowVol)};${n2(f.value)};${f.held ? "sí" : ""}`);
    const heldF = r.factors.filter((f) => f.held && !top.includes(f));
    if (heldF.length) L.push(`Posiciones fuera del top: ${heldF.map((f) => `${f.symbol} (puesto ${r.factors.indexOf(f) + 1}/${r.factors.length}, score ${n2(f.score)})`).join(", ")}`);
  }
  const pm = r.postmortem;
  if (pm.trades.length) {
    L.push(`Post-mortem de operaciones (vs benchmark desde cada operación): acierto ${p(pm.hitRate, 0)}, exceso medio ${p(pm.avgExcess)}.`);
    for (const t of pm.trades.slice(-15)) L.push(`- ${t.at.slice(0, 10)} ${t.side === "buy" ? "compra" : "venta"} ${t.symbol}: activo ${p(t.ret)}, benchmark ${p(t.benchRet)}, exceso ${p(t.excess)} (${t.days} días)`);
  }
  return L.join("\n");
}
