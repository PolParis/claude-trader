// Cierre diario (sin Claude). Lo lanza GitHub Actions de lunes a viernes después del cierre
// de EE. UU.; también se puede lanzar a mano: `npm run close-day`.
//  1. Marca como "no realizadas" las ejecuciones programadas que no ocurrieron (PC apagado...).
//  2. Revisa/caduca órdenes limitadas pendientes.
//  3. Registra dividendos y splits de las posiciones.
//  4. Guarda el snapshot de cierre (cartera + benchmarks).
//  5. En GitHub Actions, añade los hashes de cabeza de cada cadena a integrity/anchors.jsonl.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sessionFor, zonedParts, zonedTimeToUtc } from "@/core/calendar";
import { eur } from "@/core/money";
import { applyEvent, quantityHeldBefore } from "@/core/portfolio";
import type { LedgerEvent, MarketId } from "@/core/types";
import { adminClient, finishRun, insertChained, insertQuotes, listStartedExperiments, readAll, reserveRun, type Db, type Experiment } from "./lib/db";
import { defaultProvider } from "./lib/market/yahoo";
import { FX_SYMBOL, fxFromQuotes, loadState, quoteRows, resolvePendingOrders, writeSnapshot } from "./lib/ops";
import { BENCHMARKS } from "@/core/benchmarks";

const CHAINED = ["journal_entries", "orders", "fills", "order_events", "corporate_actions", "watchlist_events", "benchmarks", "snapshots", "explanations", "agent_reports"];
const TRADING: MarketId[] = ["US", "XETRA", "EURONEXT", "BME"];
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

/**
 * Día bursátil que se cierra. GitHub Actions a veces lanza el cron con horas de retraso: si ya es
 * madrugada en Madrid (antes de las 09:00, sin bolsas abiertas), el cierre es del día anterior.
 * `ref` es las 23:00 de ese día en Madrid, para consultar sesiones y franjas de ese día.
 */
function closingDay(now: Date): { day: string; ref: Date } {
  const p = zonedParts(now, "Europe/Madrid");
  const base = new Date(Date.UTC(p.year, p.month - 1, p.hour < 9 ? p.day - 1 : p.day));
  const [y, m, d] = [base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate()];
  return { day: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, ref: zonedTimeToUtc(y, m, d, 23, 0, "Europe/Madrid") };
}

async function closeExperiment(db: Db, exp: Experiment, now: Date, hostname: string) {
  const { day: runDate, ref } = closingDay(now);
  const marketDay = TRADING.some((m) => sessionFor(m, ref) !== null);
  const run = await reserveRun(db, { experimentId: exp.id, runDate, slot: "CLOSE", kind: "close", hostname });
  if (!run) {
    log(`${exp.code}: el cierre de ${runDate} ya estaba hecho.`);
    return;
  }
  const t0 = Date.now();
  const provider = defaultProvider();
  try {
    // 1. Ejecuciones programadas que no se hicieron.
    const notes: string[] = [];
    if (marketDay) {
      const { data: runs } = await db.from("runs").select("slot").eq("experiment_id", exp.id).eq("run_date", runDate);
      const done = new Set((runs ?? []).map((r) => r.slot));
      for (const slot of ["S1", "S2"]) {
        const [y, m, d] = runDate.split("-").map(Number);
        const slotTime = zonedTimeToUtc(y, m, d, slot === "S1" ? 16 : 21, slot === "S1" ? 30 : 0, "Europe/Madrid");
        if (done.has(slot) || exp.startedAt! > slotTime || slotTime > now) continue;
        const missed = await reserveRun(db, { experimentId: exp.id, runDate, slot, kind: "scheduled", hostname });
        if (!missed) continue;
        await insertChained(db, "journal_entries", {
          experiment_id: exp.id,
          run_id: missed.id,
          at: now,
          kind: "run_failed",
          summary: `Ejecución programada ${slot === "S1" ? "de las 16:30" : "de las 21:00"} no realizada: el equipo no la lanzó (apagado, sin conexión o tarea fallida).`,
          tickers: [],
        });
        await finishRun(db, missed.id, "failed", { error: "No realizada: no se reservó la franja durante el día" });
        notes.push(`${slot} no realizada`);
      }
    }

    // 2. Órdenes limitadas.
    const state = await loadState(db, exp);
    const held = [...state.portfolio.positions.keys()];
    const benchSymbols = BENCHMARKS.flatMap((b) => (b.symbol ? [b.symbol] : []));
    const quotes = await provider.getQuotes([...new Set([...held, ...state.pending.map((p) => p.symbol), ...benchSymbols, FX_SYMBOL])]);
    const fx = fxFromQuotes(quotes);
    await insertQuotes(db, quoteRows(quotes.values(), exp.id, run.id));
    notes.push(...(await resolvePendingOrders({ db, provider, exp, state, fx, runId: run.id, now, log })));

    // 3. Dividendos y splits (de lo que se tiene o se tuvo en los últimos 40 días).
    const since = new Date(Math.max(exp.startedAt!.getTime(), now.getTime() - 40 * 86_400_000));
    const recentSymbols = new Set(held);
    for (const ev of state.events) if (ev.type === "fill" && ev.at >= since) recentSymbols.add(ev.fill.symbol);
    const existing = new Set((await readAll(db, "corporate_actions", exp.id)).map((c) => `${c.symbol}|${c.kind}|${c.ex_date}`));
    for (const symbol of recentSymbols) {
      let events: Awaited<ReturnType<typeof provider.getEvents>> = [];
      try {
        events = await provider.getEvents(symbol, since);
      } catch (e) {
        log(`Sin eventos de ${symbol}: ${(e as Error).message}`);
        continue;
      }
      for (const ev of events) {
        const exDate = ev.date.toISOString().slice(0, 10);
        if (ev.date > now || ev.date < exp.startedAt! || existing.has(`${symbol}|${ev.kind}|${exDate}`)) continue;
        const exAt = new Date(`${exDate}T00:00:00Z`);
        const qty = quantityHeldBefore(state.events, symbol, exAt);
        if (qty <= 0) continue;
        const q = quotes.get(symbol);
        const currency = q?.currency === "USD" ? "USD" : "EUR";
        const rate = currency === "EUR" ? 1 : (fx.USD?.rate ?? null);
        let ledger: LedgerEvent;
        if (ev.kind === "dividend") {
          if (!rate) continue;
          const cash = eur((qty * ev.amount!) / rate);
          await insertChained(db, "corporate_actions", {
            experiment_id: exp.id, run_id: run.id, at: now, symbol, kind: "dividend", ex_date: exDate,
            amount_local: ev.amount, currency, quantity_held: qty, fx_rate: rate, cash_eur: cash, source: provider.name,
          });
          ledger = { type: "dividend", at: exAt, symbol, cashEur: cash };
          notes.push(`Dividendo ${symbol}: ${qty} × ${ev.amount} ${currency} = ${cash} €`);
        } else {
          await insertChained(db, "corporate_actions", {
            experiment_id: exp.id, run_id: run.id, at: now, symbol, kind: "split", ex_date: exDate,
            ratio: ev.ratio, quantity_held: qty, source: provider.name,
          });
          ledger = { type: "split", at: exAt, symbol, ratio: ev.ratio! };
          notes.push(`Split ${symbol}: ratio ${ev.ratio}`);
        }
        state.events.push(ledger);
        applyEvent(state.portfolio, ledger);
        existing.add(`${symbol}|${ev.kind}|${exDate}`);
      }
    }

    // 4. Snapshot de cierre (solo días con algún mercado abierto).
    if (marketDay) await writeSnapshot({ db, exp, state, quotes, fx, kind: "close", runId: run.id, now, snapshotDate: runDate });
    for (const n of notes) log(`${exp.code}: ${n}`);
    await finishRun(db, run.id, marketDay ? "completed" : "skipped", { summary: { notes }, duration_ms: Date.now() - t0 });
    log(`${exp.code}: cierre ${runDate} completado.`);
  } catch (e) {
    log(`${exp.code}: ERROR ${(e as Error).stack}`);
    await finishRun(db, run.id, "failed", { error: String((e as Error).stack).slice(0, 4000), duration_ms: Date.now() - t0 }).catch(() => {});
    process.exitCode = 1;
  }
}

async function anchor(db: Db, experiments: Experiment[], now: Date) {
  const file = path.resolve(process.cwd(), "integrity", "anchors.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const exp of experiments) {
    const heads: Record<string, { seq: number; hash: string } | null> = {};
    for (const t of CHAINED) {
      const { data } = await db.from(t).select("seq,hash").eq("experiment_id", exp.id).order("seq", { ascending: false }).limit(1);
      heads[t] = data?.[0] ? { seq: Number(data[0].seq), hash: data[0].hash } : null;
    }
    fs.appendFileSync(file, JSON.stringify({ at: now.toISOString(), date: closingDay(now).day, experiment: exp.code, heads }) + "\n");
  }
  log(`Anclas añadidas a ${file}`);
}

async function main() {
  const db = adminClient();
  const now = new Date();
  const hostname = process.env.GITHUB_ACTIONS ? "github-actions" : os.hostname();
  const experiments = await listStartedExperiments(db);
  for (const exp of experiments) await closeExperiment(db, exp, now, hostname);
  // Las anclas solo se escriben desde GitHub Actions (que las commitea); en local, con --anchor.
  if (process.env.GITHUB_ACTIONS || process.argv.includes("--anchor")) await anchor(db, experiments, now);
}

main().catch((e) => {
  log(`ERROR FATAL: ${(e as Error).stack}`);
  process.exit(1);
});
