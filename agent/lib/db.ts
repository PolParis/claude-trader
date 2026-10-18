// Acceso de escritura a Supabase para los scripts locales y GitHub Actions.
// Usa la clave SECRETA (SUPABASE_SECRET_KEY): nunca se importa desde la web.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { canonicalJson } from "@/core/hash";
import type { PendingOrder } from "@/core/engine";
import type { BenchmarkPosition } from "@/core/benchmarks";
import { DEFAULT_CONFIG, type Currency, type ExperimentConfig, type LedgerEvent } from "@/core/types";

export type Db = SupabaseClient;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name} (revisa .env.local)`);
  return v;
}

export function adminClient(): Db {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface Experiment {
  id: string;
  code: string;
  name: string;
  mode: "test" | "official";
  startedAt: Date | null;
  model: string;
  config: ExperimentConfig;
}

export function toExperiment(r: Row): Experiment {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    mode: r.mode,
    startedAt: r.started_at ? new Date(r.started_at) : null,
    model: r.agent_model,
    config: {
      ...DEFAULT_CONFIG,
      initialCapital: Number(r.initial_capital),
      commissionPct: Number(r.commission_pct),
      commissionMin: Number(r.commission_min),
      slippagePct: Number(r.slippage_pct),
      fxFeePct: Number(r.fx_fee_pct),
      maxPositionPct: Number(r.max_position_pct),
      allowCrypto: r.allow_crypto,
      allowFractional: r.allow_fractional,
      riskFreeRate: Number(r.risk_free_rate),
      maxQuoteAgeMinutes: Number(r.max_quote_age_minutes),
    },
  };
}

function check<T>(res: { data: T; error: { message: string; code?: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export async function getExperiment(db: Db, code: string): Promise<Experiment> {
  const data = check(await db.from("experiments").select("*").eq("code", code).maybeSingle(), "Leer experimento");
  if (!data) throw new Error(`No existe el experimento "${code}"`);
  return toExperiment(data);
}

export async function listStartedExperiments(db: Db): Promise<Experiment[]> {
  const data = check(await db.from("experiments").select("*").not("started_at", "is", null), "Listar experimentos");
  return (data as Row[]).map(toExperiment);
}

/** Lee todas las filas de una tabla de un experimento (paginando de 1000 en 1000). */
export async function readAll(db: Db, table: string, experimentId: string, order = "id"): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const page = check(
      await db.from(table).select("*").eq("experiment_id", experimentId).order(order).range(from, from + 999),
      `Leer ${table}`,
    ) as Row[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

/**
 * Inserta en una tabla encadenada. El payload firmado es el JSON canónico exacto de los
 * campos insertados; seq/prev_hash/hash los pone el trigger de la BD.
 */
export async function insertChained(db: Db, table: string, fields: Row): Promise<Row> {
  const clean: Row = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) clean[k] = v instanceof Date ? v.toISOString() : v;
  const payload = canonicalJson(clean);
  const res = await db
    .from(table)
    .insert({ ...clean, payload, seq: 0, prev_hash: "", hash: "", recorded_at: new Date().toISOString() })
    .select("*")
    .single();
  return check(res, `Insertar en ${table}`) as Row;
}

// ---------- Reserva de franja ----------

export async function reserveRun(
  db: Db,
  args: { experimentId: string; runDate: string; slot: string; kind: string; hostname: string; model?: string },
): Promise<Row | null> {
  const res = await db
    .from("runs")
    .insert({
      experiment_id: args.experimentId,
      run_date: args.runDate,
      slot: args.slot,
      kind: args.kind,
      hostname: args.hostname,
      model: args.model ?? null,
    })
    .select("*")
    .single();
  if (res.error?.code === "23505") return null; // franja ya reservada (por este u otro PC)
  return check(res, "Reservar ejecución") as Row;
}

export async function finishRun(db: Db, runId: string, status: "completed" | "failed" | "skipped", fields: Row = {}) {
  check(
    await db
      .from("runs")
      .update({ status, finished_at: new Date().toISOString(), ...fields })
      .eq("id", runId),
    "Cerrar ejecución",
  );
}

// ---------- Lectura del estado ----------

export function fillRowToEvent(f: Row): LedgerEvent {
  return {
    type: "fill",
    at: new Date(f.at),
    fill: {
      symbol: f.symbol,
      side: f.side,
      quantity: Number(f.quantity),
      priceLocal: Number(f.price_local),
      refPriceLocal: Number(f.ref_price_local),
      currency: f.currency,
      fxRate: Number(f.fx_rate),
      fxSource: f.fx_source,
      fxTime: f.fx_time ? new Date(f.fx_time) : null,
      grossEur: Number(f.gross_eur),
      commissionEur: Number(f.commission_eur),
      fxFeeEur: Number(f.fx_fee_eur),
      cashDeltaEur: Number(f.cash_delta_eur),
      executedAt: new Date(f.at),
      priceSource: f.price_source,
      priceTime: f.price_time ? new Date(f.price_time) : new Date(f.at),
    },
  };
}

export function corporateRowToEvent(c: Row): LedgerEvent {
  // Se aplica al inicio del día ex (antes de cualquier operación de ese día).
  const at = new Date(`${c.ex_date}T00:00:00Z`);
  return c.kind === "split"
    ? { type: "split", at, symbol: c.symbol, ratio: Number(c.ratio) }
    : { type: "dividend", at, symbol: c.symbol, cashEur: Number(c.cash_eur) };
}

export async function loadLedger(db: Db, experimentId: string): Promise<LedgerEvent[]> {
  const [fills, actions] = await Promise.all([
    readAll(db, "fills", experimentId),
    readAll(db, "corporate_actions", experimentId),
  ]);
  return [...fills.map(fillRowToEvent), ...actions.map(corporateRowToEvent)];
}

export async function loadPendingOrders(db: Db, experimentId: string): Promise<(PendingOrder & { currency?: Currency })[]> {
  const [orders, fills, events] = await Promise.all([
    db.from("orders").select("*").eq("experiment_id", experimentId).eq("status", "pending"),
    db.from("fills").select("order_id").eq("experiment_id", experimentId),
    db.from("order_events").select("order_id").eq("experiment_id", experimentId),
  ]);
  const done = new Set([...(check(fills, "fills") as Row[]), ...(check(events, "eventos") as Row[])].map((r) => r.order_id));
  return (check(orders, "órdenes pendientes") as Row[])
    .filter((o) => !done.has(o.id))
    .map((o) => ({
      orderId: o.id,
      symbol: o.symbol,
      side: o.side,
      quantity: Number(o.quantity),
      limitPrice: Number(o.limit_price),
      reservedCashEur: Number(o.reserved_cash_eur ?? 0),
      placedAt: new Date(o.at),
      expiresAt: new Date(o.expires_at),
      currency: o.quote_currency ?? undefined,
    }));
}

export async function loadRecentJournal(db: Db, experimentId: string, n = 20): Promise<Row[]> {
  const data = check(
    await db.from("journal_entries").select("*").eq("experiment_id", experimentId).order("seq", { ascending: false }).limit(n),
    "Leer diario",
  ) as Row[];
  return data.reverse();
}

export async function loadWatchlist(db: Db, experimentId: string): Promise<Map<string, string>> {
  const rows = await readAll(db, "watchlist_events", experimentId, "seq");
  const wl = new Map<string, string>();
  for (const r of rows) {
    if (r.action === "add") wl.set(r.symbol, r.reason ?? "");
    else wl.delete(r.symbol);
  }
  return wl;
}

export async function loadBenchmarks(db: Db, experimentId: string): Promise<(BenchmarkPosition & { symbol: string | null; currency: Currency })[]> {
  const rows = check(await db.from("benchmarks").select("*").eq("experiment_id", experimentId), "Leer benchmarks") as Row[];
  return rows.map((b) => ({
    code: b.code,
    symbol: b.symbol,
    currency: b.currency,
    units: Number(b.units),
    buyPriceLocal: Number(b.buy_price_local),
    fxRate: Number(b.fx_rate),
    grossEur: Number(b.gross_eur),
    commissionEur: Number(b.commission_eur),
    cashLeftEur: Number(b.cash_left_eur),
  }));
}

export async function insertQuotes(db: Db, rows: Row[]) {
  for (let i = 0; i < rows.length; i += 500) check(await db.from("price_quotes").insert(rows.slice(i, i + 500)), "Guardar precios");
}

export async function upsertInstruments(db: Db, rows: Row[]) {
  if (rows.length) check(await db.from("instruments").upsert(rows, { onConflict: "symbol" }), "Guardar instrumentos");
}
