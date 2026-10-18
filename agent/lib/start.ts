// Inicio de un experimento: fija la fecha de inicio y compra los benchmarks (una sola vez).
import { BENCHMARKS, initBenchmark } from "@/core/benchmarks";
import { isMarketOpen } from "@/core/calendar";
import { derivePortfolio } from "@/core/portfolio";
import { insertChained, loadBenchmarks, type Db, type Experiment } from "./db";
import type { MarketDataProvider } from "./market/provider";
import { FX_SYMBOL, fxFromQuotes, writeSnapshot } from "./ops";

export async function startExperiment(db: Db, exp: Experiment, provider: MarketDataProvider, now: Date, log: (m: string) => void) {
  if (exp.startedAt) throw new Error(`El experimento ${exp.code} ya empezó el ${exp.startedAt.toISOString()}`);
  const symbols = BENCHMARKS.flatMap((b) => (b.symbol ? [b.symbol] : []));
  const quotes = await provider.getQuotes([...symbols, FX_SYMBOL]);
  for (const b of BENCHMARKS) {
    if (!b.symbol || !b.market) continue;
    const q = quotes.get(b.symbol);
    if (!q) throw new Error(`Sin cotización del benchmark ${b.symbol}`);
    if (!isMarketOpen(b.market, now) || q.marketState !== "REGULAR")
      throw new Error(`El mercado del benchmark ${b.symbol} está cerrado: el experimento solo puede empezar de 09:00 a 17:30 (Madrid), en día laborable`);
  }
  const existing = new Set((await loadBenchmarks(db, exp.id)).map((b) => b.code));
  for (const b of BENCHMARKS) {
    if (existing.has(b.code)) continue;
    const q = b.symbol ? quotes.get(b.symbol)! : null;
    const pos = initBenchmark(b.code, exp.config.initialCapital, q?.price ?? null, 1, exp.config);
    await insertChained(db, "benchmarks", {
      experiment_id: exp.id,
      code: b.code,
      name: b.name,
      symbol: b.symbol,
      currency: b.currency,
      units: pos.units,
      buy_price_local: pos.buyPriceLocal,
      fx_rate: pos.fxRate,
      gross_eur: pos.grossEur,
      commission_eur: pos.commissionEur,
      cash_left_eur: pos.cashLeftEur,
      bought_at: now,
      price_source: q ? `${q.source} (${q.quoteTime.toISOString()})` : null,
    });
    log(`Benchmark ${b.name}: ${pos.units} unidades a ${pos.buyPriceLocal} (efectivo sobrante ${pos.cashLeftEur} €)`);
  }
  const upd = await db.from("experiments").update({ started_at: now.toISOString() }).eq("id", exp.id).is("started_at", null);
  if (upd.error) throw new Error(`No se pudo fijar la fecha de inicio: ${upd.error.message}`);
  exp.startedAt = now;
  await insertChained(db, "journal_entries", {
    experiment_id: exp.id,
    run_id: null,
    at: now,
    kind: "system",
    summary: `Inicio del experimento "${exp.name}" con ${exp.config.initialCapital} € ficticios. Benchmarks comprados al precio de este momento.`,
    tickers: [],
  });
  const state = {
    events: [],
    portfolio: derivePortfolio(exp.config.initialCapital, []),
    pending: [],
    benchmarks: await loadBenchmarks(db, exp.id),
  };
  await writeSnapshot({ db, exp, state, quotes, fx: fxFromQuotes(quotes), kind: "start", runId: null, now });
  log(`Experimento ${exp.code} iniciado el ${now.toISOString()}`);
}
