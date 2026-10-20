// Operaciones compartidas por run-agent, close-day y start-experiment.
import { benchmarkValueEur, BENCHMARKS } from "@/core/benchmarks";
import { madridDate } from "@/core/calendar";
import type { PendingOrder } from "@/core/engine";
import { resolvePendingOrder } from "@/core/limits";
import { eur } from "@/core/money";
import { applyEvent, derivePortfolio, valuePortfolio, type PortfolioState } from "@/core/portfolio";
import type { Currency, FxRate, LedgerEvent, Quote } from "@/core/types";
import { insertChained, loadBenchmarks, loadLedger, loadPendingOrders, type Db, type Experiment } from "./db";
import type { MarketDataProvider, MarketQuote } from "./market/provider";

export const FX_SYMBOL = "EURUSD=X";

export function fxFromQuotes(quotes: Map<string, Quote>): Partial<Record<Currency, FxRate>> {
  const q = quotes.get(FX_SYMBOL);
  return q ? { USD: { currency: "USD", rate: q.price, source: `${q.source} ${FX_SYMBOL}`, time: q.quoteTime } } : {};
}

export interface LoadedState {
  events: LedgerEvent[];
  portfolio: PortfolioState;
  pending: (PendingOrder & { currency?: Currency })[];
  benchmarks: Awaited<ReturnType<typeof loadBenchmarks>>;
}

export async function loadState(db: Db, exp: Experiment): Promise<LoadedState> {
  const [events, pending, benchmarks] = await Promise.all([
    loadLedger(db, exp.id),
    loadPendingOrders(db, exp.id),
    loadBenchmarks(db, exp.id),
  ]);
  return { events, portfolio: derivePortfolio(exp.config.initialCapital, events), pending, benchmarks };
}

/** Revisa las órdenes limitadas pendientes con barras de 5 min: ejecuta, caduca o deja pendientes. */
export async function resolvePendingOrders(args: {
  db: Db;
  provider: MarketDataProvider;
  exp: Experiment;
  state: LoadedState;
  fx: Partial<Record<Currency, FxRate>>;
  runId: string | null;
  now: Date;
  log: (msg: string) => void;
}): Promise<string[]> {
  const { db, exp, state, now } = args;
  const notes: string[] = [];
  const stillPending: LoadedState["pending"] = [];
  for (const order of state.pending) {
    const currency: Currency = order.currency === "USD" ? "USD" : "EUR";
    let bars: Awaited<ReturnType<MarketDataProvider["getIntradayBars"]>> = [];
    try {
      bars = await args.provider.getIntradayBars(order.symbol, order.placedAt, new Date(Math.min(now.getTime(), order.expiresAt.getTime() + 600_000)));
    } catch (e) {
      args.log(`No se pudieron leer barras de ${order.symbol}: ${(e as Error).message}`);
      if (now < order.expiresAt) {
        stillPending.push(order);
        continue;
      }
    }
    const outcome = resolvePendingOrder({
      order,
      bars,
      now,
      currency,
      fx: currency === "EUR" ? null : (args.fx[currency] ?? null),
      config: exp.config,
      source: args.provider.name,
    });
    if (outcome.status === "filled") {
      const f = outcome.fill;
      if (f.side === "buy" && -f.cashDeltaEur > state.portfolio.cashEur + 1e-9) {
        await insertChained(db, "order_events", {
          experiment_id: exp.id,
          order_id: order.orderId,
          run_id: args.runId,
          at: now,
          event: "cancelled",
          reason: "Efectivo insuficiente al ejecutar (variación del tipo de cambio)",
        });
        notes.push(`Orden limitada ${order.symbol} cancelada por efectivo insuficiente`);
        continue;
      }
      await insertFill(db, exp.id, order.orderId!, args.runId, f);
      applyEvent(state.portfolio, { type: "fill", at: f.executedAt, fill: f });
      state.events.push({ type: "fill", at: f.executedAt, fill: f });
      notes.push(`Orden limitada ejecutada: ${f.side === "buy" ? "compra" : "venta"} ${f.quantity} ${f.symbol} a ${f.priceLocal}`);
    } else if (outcome.status === "expired") {
      await insertChained(db, "order_events", {
        experiment_id: exp.id,
        order_id: order.orderId,
        run_id: args.runId,
        at: now,
        event: "expired",
        reason: "El precio no alcanzó el límite durante la sesión",
      });
      notes.push(`Orden limitada caducada: ${order.side === "buy" ? "compra" : "venta"} ${order.quantity} ${order.symbol} a ${order.limitPrice}`);
    } else {
      stillPending.push(order);
    }
  }
  state.pending = stillPending;
  return notes;
}

export async function insertFill(db: Db, experimentId: string, orderId: number, runId: string | null, f: import("@/core/types").Fill) {
  return insertChained(db, "fills", {
    experiment_id: experimentId,
    order_id: orderId,
    run_id: runId,
    at: f.executedAt,
    symbol: f.symbol,
    side: f.side,
    quantity: f.quantity,
    price_local: f.priceLocal,
    ref_price_local: f.refPriceLocal,
    currency: f.currency,
    fx_rate: f.fxRate,
    fx_source: f.fxSource,
    fx_time: f.fxTime,
    gross_eur: f.grossEur,
    commission_eur: f.commissionEur,
    fx_fee_eur: f.fxFeeEur,
    cash_delta_eur: f.cashDeltaEur,
    price_source: f.priceSource,
    price_time: f.priceTime,
  });
}

export function benchmarkValues(state: LoadedState, quotes: Map<string, Quote>, fx: Partial<Record<Currency, FxRate>>) {
  const out: Record<string, number> = {};
  for (const def of BENCHMARKS) {
    const b = state.benchmarks.find((x) => x.code === def.code);
    if (!b) continue;
    const price = b.symbol ? (quotes.get(b.symbol)?.price ?? null) : null;
    const rate = b.currency === "EUR" ? 1 : (fx[b.currency]?.rate ?? 1);
    out[def.code] = b.symbol && price === null ? eur(b.grossEur + b.cashLeftEur) : benchmarkValueEur(b, price, rate);
  }
  return out;
}

export async function writeSnapshot(args: {
  db: Db;
  exp: Experiment;
  state: LoadedState;
  quotes: Map<string, Quote>;
  fx: Partial<Record<Currency, FxRate>>;
  kind: "start" | "run" | "close";
  runId: string | null;
  now: Date;
  snapshotDate?: string;
}) {
  const prices = new Map([...args.quotes].map(([s, q]) => [s, q.price]));
  const fxRates: Partial<Record<Currency, number>> = { USD: args.fx.USD?.rate };
  const v = valuePortfolio(args.state.portfolio, prices, fxRates);
  return insertChained(args.db, "snapshots", {
    experiment_id: args.exp.id,
    run_id: args.runId,
    kind: args.kind,
    at: args.now,
    snapshot_date: args.snapshotDate ?? madridDate(args.now),
    cash_eur: v.cashEur,
    positions_value_eur: v.positionsValueEur,
    total_eur: v.totalEur,
    holdings: v.holdings.map((h) => ({ ...h, priceLocal: Number(h.priceLocal.toFixed(6)) })),
    benchmarks: benchmarkValues(args.state, args.quotes, args.fx),
  });
}

export function quoteRows(quotes: Iterable<MarketQuote>, experimentId: string, runId: string | null) {
  return [...quotes].map((q) => ({
    experiment_id: experimentId,
    run_id: runId,
    symbol: q.symbol,
    price: q.price,
    currency: q.currency,
    source: q.source,
    quote_time: q.quoteTime.toISOString(),
    fetched_at: q.fetchedAt.toISOString(),
    delay_s: Math.round((q.fetchedAt.getTime() - q.quoteTime.getTime()) / 1000),
    declared_delay_min: q.declaredDelayMin,
    market_state: q.marketState,
  }));
}

export function instrumentRows(quotes: Iterable<MarketQuote>, regions: Map<string, string>) {
  return [...quotes]
    .filter((q) => q.market && (q.currency === "EUR" || q.currency === "USD"))
    .map((q) => ({
      symbol: q.symbol,
      name: q.name,
      market: q.market,
      currency: q.currency,
      kind: q.quoteType === "ETF" ? "etf" : q.quoteType === "CRYPTOCURRENCY" ? "crypto" : "stock",
      region: regions.get(q.symbol) ?? null,
      yahoo_exchange: q.exchangeCode,
      updated_at: new Date().toISOString(),
    }));
}
