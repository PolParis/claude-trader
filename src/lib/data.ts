// Carga de datos para la web (solo lectura, con la sesión del usuario) y cálculos derivados.
import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { BENCHMARKS } from "@/core/benchmarks";
import type { SeriesPoint } from "@/core/metrics";
import { derivePortfolio, type PortfolioState } from "@/core/portfolio";
import { corporateRowToEvent, fillRowToEvent } from "./rows";
import { createClient } from "./supabase/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export const EXP_COOKIE = "exp";

export const getContext = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("experiments").select("*").order("created_at");
  const experiments = (data ?? []) as Row[];
  const wanted = (await cookies()).get(EXP_COOKIE)?.value;
  const exp = experiments.find((e) => e.code === wanted) ?? experiments.find((e) => e.is_default) ?? experiments[0] ?? null;
  return { supabase, experiments, exp };
});

type Client = Awaited<ReturnType<typeof createClient>>;

async function readAll(supabase: Client, table: string, experimentId: string, order = "id", columns = "*"): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).eq("experiment_id", experimentId).order(order).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) return out;
  }
}

export interface ChartPoint {
  t: number;
  kind: string;
  portfolio: number;
  [benchmark: string]: number | string;
}

export interface DashboardData {
  exp: Row;
  fills: Row[];
  orders: Row[];
  orderEvents: Row[];
  corporate: Row[];
  snapshots: Row[];
  journal: Row[];
  runs: Row[];
  benchmarks: Row[];
  watchlist: Row[];
  instruments: Map<string, Row>;
  portfolio: PortfolioState;
  latest: Row | null;
  chart: ChartPoint[];
  daily: SeriesPoint[];
  dailyBenchmarks: Record<string, SeriesPoint[]>;
}

export const loadData = cache(async (exp: Row): Promise<DashboardData> => {
  const { supabase } = await getContext();
  const id = exp.id as string;
  const [fills, orders, orderEvents, corporate, snapshots, journal, runs, benchmarks, watchlist, instr] = await Promise.all([
    readAll(supabase, "fills", id),
    readAll(supabase, "orders", id),
    readAll(supabase, "order_events", id),
    readAll(supabase, "corporate_actions", id),
    readAll(supabase, "snapshots", id, "seq", "id,run_id,kind,at,snapshot_date,cash_eur,positions_value_eur,total_eur,holdings,benchmarks,seq,hash"),
    readAll(supabase, "journal_entries", id, "seq"),
    readAll(supabase, "runs", id, "reserved_at", "id,run_date,slot,kind,hostname,status,reserved_at,finished_at,model,error,summary,duration_ms,prompt_chars"),
    readAll(supabase, "benchmarks", id),
    readAll(supabase, "watchlist_events", id, "seq"),
    supabase.from("instruments").select("*"),
  ]);
  const events = [...fills.map(fillRowToEvent), ...corporate.map(corporateRowToEvent)];
  const portfolio = derivePortfolio(Number(exp.initial_capital), events);
  const latest = snapshots.at(-1) ?? null;

  const chart: ChartPoint[] = snapshots.map((s) => {
    const p: ChartPoint = { t: new Date(s.at).getTime(), kind: s.kind, portfolio: Number(s.total_eur) };
    for (const b of BENCHMARKS) if (s.benchmarks?.[b.code] !== undefined) p[b.code] = Number(s.benchmarks[b.code]);
    return p;
  });

  // Serie diaria para métricas: valor de inicio + un cierre por día (o la última foto del día si no hubo cierre).
  const start = snapshots.find((s) => s.kind === "start");
  const byDay = new Map<string, Row>();
  for (const s of snapshots) {
    if (s.kind === "start") continue;
    const prev = byDay.get(s.snapshot_date);
    if (!prev || prev.kind !== "close") byDay.set(s.snapshot_date, s);
  }
  const dayRows = [...(start ? [start] : []), ...[...byDay.values()].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))];
  const daily = dayRows.map((s) => ({ date: s.snapshot_date, value: Number(s.total_eur) }));
  const dailyBenchmarks: Record<string, SeriesPoint[]> = {};
  for (const b of BENCHMARKS)
    dailyBenchmarks[b.code] = dayRows.filter((s) => s.benchmarks?.[b.code] !== undefined).map((s) => ({ date: s.snapshot_date, value: Number(s.benchmarks[b.code]) }));

  return {
    exp,
    fills,
    orders,
    orderEvents,
    corporate,
    snapshots,
    journal,
    runs,
    benchmarks,
    watchlist,
    instruments: new Map(((instr.data ?? []) as Row[]).map((i) => [i.symbol, i])),
    portfolio,
    latest,
    chart,
    daily,
    dailyBenchmarks,
  };
});

/** Precio y tipo de cambio de cada activo según el último snapshot. */
export function latestPrices(latest: Row | null): Map<string, { price: number; fx: number }> {
  const m = new Map<string, { price: number; fx: number }>();
  for (const h of (latest?.holdings ?? []) as Row[]) m.set(h.symbol, { price: Number(h.priceLocal), fx: Number(h.fxRate) || 1 });
  return m;
}
