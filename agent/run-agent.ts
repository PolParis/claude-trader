// Ejecución del agente: `npm run run-agent -- --slot S1|S2` (programada) o sin --slot (manual).
// Opciones de prueba: --dry-run (lee la BD pero no escribe nada), --offline (sin BD, cartera
// vacía; implica --dry-run), --force (llama a Claude aunque todos los mercados estén cerrados).
import os from "node:os";
import { BENCHMARKS } from "@/core/benchmarks";
import { isMarketOpen, madridDate, zonedParts } from "@/core/calendar";
import { executeOrders } from "@/core/engine";
import { sha256Hex } from "@/core/hash";
import { avgPriceLocal, derivePortfolio, valuePortfolio } from "@/core/portfolio";
import { DEFAULT_CONFIG, type Currency, type Instrument, type MarketId, type OrderRequest } from "@/core/types";
import { MAX_WATCHLIST_EXTRA } from "@/core/universe";
import { callClaude } from "./lib/agent/claude";
import { buildPrompt, systemPrompt } from "./lib/agent/prompt";
import { decisionJsonSchema, parseDecision, type Decision } from "./lib/agent/schema";
import {
  adminClient,
  finishRun,
  getExperiment,
  insertChained,
  insertQuotes,
  loadRecentJournal,
  loadWatchlist,
  reserveRun,
  upsertInstruments,
  type Db,
  type Experiment,
} from "./lib/db";
import { gatherMarketData } from "./lib/market-data";
import { defaultProvider } from "./lib/market/yahoo";
import { benchmarkValues, fxFromQuotes, insertFill, instrumentRows, loadState, quoteRows, resolvePendingOrders, writeSnapshot, type LoadedState } from "./lib/ops";
import { startExperiment } from "./lib/start";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);
const SLOT_LABELS: Record<string, string> = { S1: "programada 16:30", S2: "programada 21:00" };
const TRADING_MARKETS: MarketId[] = ["US", "XETRA", "EURONEXT", "BME"];

async function main() {
  const offline = flag("offline");
  const dryRun = offline || flag("dry-run");
  const now = new Date();
  const slotArg = opt("slot");
  const p = zonedParts(now, "Europe/Madrid");
  const slot = slotArg ?? `M${String(p.hour).padStart(2, "0")}${String(p.minute).padStart(2, "0")}`;
  const kind = slotArg ? "scheduled" : "manual";
  const slotLabel = SLOT_LABELS[slot] ?? "manual";
  const hostname = os.hostname();
  const provider = defaultProvider();

  let db: Db | null = null;
  let exp: Experiment;
  if (offline) {
    exp = { id: "offline", code: "offline", name: "Prueba sin conexión", mode: "test", startedAt: null, model: opt("model") ?? "sonnet", config: DEFAULT_CONFIG };
  } else {
    db = adminClient();
    exp = await getExperiment(db, opt("experiment") ?? process.env.EXPERIMENT_CODE ?? "test-1");
  }
  const model = opt("model") ?? exp.model;
  log(`Experimento ${exp.code} · franja ${slot} (${kind}) · equipo ${hostname} · modelo ${model}${dryRun ? " · SIN ESCRITURA" : ""}`);

  const anyOpen = TRADING_MARKETS.some((m) => isMarketOpen(m, now));

  // Inicio automático solo para experimentos de prueba; el oficial se inicia a mano.
  if (db && !exp.startedAt) {
    if (exp.mode !== "test" || dryRun) throw new Error(`El experimento ${exp.code} no ha empezado. Usa: npm run start-experiment -- --code ${exp.code}`);
    await startExperiment(db, exp, provider, now, log);
  }

  // Reserva de la franja (UNIQUE en BD): si ya existe, otro proceso/PC ya la hizo.
  let runId: string | null = null;
  if (db && !dryRun) {
    const run = await reserveRun(db, { experimentId: exp.id, runDate: madridDate(now), slot, kind, hostname, model });
    if (!run) {
      log(`La franja ${madridDate(now)} ${slot} ya estaba reservada. No se hace nada.`);
      return;
    }
    runId = run.id;
  }
  const t0 = Date.now();

  try {
    await runBody({ db, exp, runId, now, slotLabel, model, anyOpen, dryRun, provider, t0 });
  } catch (e) {
    const message = (e as Error).stack ?? String(e);
    log(`ERROR: ${message}`);
    if (db && runId) {
      await insertChained(db, "journal_entries", {
        experiment_id: exp.id,
        run_id: runId,
        at: new Date(),
        kind: "run_failed",
        summary: `Ejecución fallida por un error técnico: ${(e as Error).message}`.slice(0, 1000),
        tickers: [],
      }).catch(() => {});
      await finishRun(db, runId, "failed", { error: message.slice(0, 4000), duration_ms: Date.now() - t0 }).catch(() => {});
    }
    process.exitCode = 1;
  }
}

async function runBody(ctx: {
  db: Db | null;
  exp: Experiment;
  runId: string | null;
  now: Date;
  slotLabel: string;
  model: string;
  anyOpen: boolean;
  dryRun: boolean;
  provider: ReturnType<typeof defaultProvider>;
  t0: number;
}) {
  const { db, exp, runId, now, provider } = ctx;
  const write = !!db && !ctx.dryRun;

  // 1. Estado actual (derivado del registro append-only).
  const state: LoadedState = db
    ? await loadState(db, exp)
    : { events: [], portfolio: derivePortfolio(exp.config.initialCapital, []), pending: [], benchmarks: [] };
  const watchlist = db ? await loadWatchlist(db, exp.id) : new Map<string, string>();
  const journal = db ? await loadRecentJournal(db, exp.id, 20) : [];

  // 2. Datos de mercado.
  const held = [...state.portfolio.positions.keys()];
  const market = await gatherMarketData(provider, {
    held,
    watchlist,
    pending: state.pending.map((o) => o.symbol),
    allowCrypto: exp.config.allowCrypto,
    log,
  });
  const fx = fxFromQuotes(market.quotes);
  log(`Datos: ${market.universe.length} activos operables, ${market.news.length} titulares, EUR/USD ${fx.USD?.rate ?? "?"}`);
  if (write) {
    await upsertInstruments(db!, instrumentRows(market.quotes.values(), market.regions));
    await insertQuotes(db!, quoteRows(market.quotes.values(), exp.id, runId));
  }

  // 3. Órdenes limitadas pendientes de ejecuciones anteriores.
  const pendingNotes = write ? await resolvePendingOrders({ db: db!, provider, exp, state, fx, runId, now, log }) : [];
  for (const n of pendingNotes) log(n);

  // 4. Si no hay ningún mercado abierto (festivo), no se llama a Claude.
  if (!ctx.anyOpen && !flag("force")) {
    log("Todos los mercados están cerrados: ejecución omitida.");
    if (write) {
      await insertChained(db!, "journal_entries", {
        experiment_id: exp.id,
        run_id: runId,
        at: new Date(),
        kind: "run_skipped",
        summary: "Ejecución omitida: todos los mercados permitidos estaban cerrados (festivo o fuera de horario).",
        tickers: [],
      });
      await writeSnapshot({ db: db!, exp, state, quotes: market.quotes, fx, kind: "run", runId, now });
      await finishRun(db!, runId!, "skipped", { duration_ms: Date.now() - ctx.t0 });
    }
    return;
  }

  // 5. Prompt.
  const prices = new Map([...market.quotes].map(([s, q]) => [s, q.price]));
  const valuation = valuePortfolio(state.portfolio, prices, { USD: fx.USD?.rate });
  const lastOrders = db
    ? ((await db.from("orders").select("at,symbol,side,quantity,status,reject_reason").eq("experiment_id", exp.id).order("seq", { ascending: false }).limit(15)).data ?? []).reverse()
    : [];
  const prompt = buildPrompt({
    now,
    slotLabel: ctx.slotLabel,
    experimentName: exp.name,
    startedAt: exp.startedAt,
    initialCapital: exp.config.initialCapital,
    eurUsd: fx.USD?.rate ?? null,
    cashEur: valuation.cashEur,
    totalEur: valuation.totalEur,
    positions: valuation.holdings.map((h) => {
      const pos = state.portfolio.positions.get(h.symbol)!;
      return {
        symbol: h.symbol,
        quantity: h.quantity,
        avgPriceLocal: avgPriceLocal(pos),
        priceLocal: h.priceLocal,
        currency: h.currency,
        valueEur: h.valueEur,
        pnlPct: (h.valueEur / h.costEur - 1) * 100,
        weightPct: (h.valueEur / valuation.totalEur) * 100,
      };
    }),
    pending: state.pending.map((o) => ({ symbol: o.symbol, side: o.side, quantity: o.quantity, limitPrice: o.limitPrice, expiresAt: o.expiresAt })),
    benchmarks: benchmarkValues(state, market.quotes, fx),
    benchmarkNames: Object.fromEntries(BENCHMARKS.map((b) => [b.code, b.name])),
    pendingNotes,
    lastOrders: lastOrders.map((o: Record<string, unknown>) => ({
      at: String(o.at).slice(0, 16).replace("T", " "),
      symbol: String(o.symbol),
      side: String(o.side),
      quantity: Number(o.quantity),
      status: String(o.status),
      reason: (o.reject_reason as string) ?? null,
    })),
    journal: journal.map((j) => ({ at: String(j.at).slice(0, 16).replace("T", " "), kind: j.kind, summary: j.summary, thesis: j.thesis, change_mind: j.change_mind })),
    context: market.context,
    news: market.news,
    universe: market.universe,
  });
  const sys = systemPrompt(exp.config, MAX_WATCHLIST_EXTRA);
  log(`Prompt: ${prompt.length} caracteres. Llamando a claude -p (${ctx.model})...`);
  if (flag("print-prompt")) console.log(`\n----- SYSTEM -----\n${sys}\n----- PROMPT -----\n${prompt}\n------------------\n`);

  // 6. Claude (una sola llamada; un único reintento solo si el JSON no es válido, antes de escribir nada).
  let decision: Decision | null = null;
  let failure: string | null = null;
  let call = await callClaude({ prompt, systemPrompt: sys, jsonSchema: decisionJsonSchema(), model: ctx.model });
  if (call.ok) {
    let parsed = parseDecision(call.output);
    if (!parsed.ok) {
      log(`Respuesta inválida (${parsed.error}). Reintentando una vez...`);
      call = await callClaude({ prompt, systemPrompt: sys, jsonSchema: decisionJsonSchema(), model: ctx.model });
      parsed = call.ok ? parseDecision(call.output) : { ok: false, error: call.error ?? "error" };
    }
    if (parsed.ok) decision = parsed.decision;
    else failure = parsed.error;
  } else failure = call.error ?? "error desconocido";
  log(`Claude respondió en ${(call.durationMs / 1000).toFixed(1)} s${failure ? ` con fallo: ${failure}` : ""}`);

  const claudeResult = call.envelope
    ? {
        usage: call.envelope.usage,
        model_usage: call.envelope.modelUsage,
        duration_ms: call.envelope.duration_ms,
        num_turns: call.envelope.num_turns,
        session_id: call.envelope.session_id,
        output: call.output,
      }
    : null;
  const runMeta = { prompt_sha256: await sha256Hex(sys + "\n" + prompt), prompt_chars: prompt.length, claude_result: claudeResult };

  if (!decision) {
    if (write) {
      await insertChained(db!, "journal_entries", {
        experiment_id: exp.id,
        run_id: runId,
        at: new Date(),
        kind: "run_failed",
        summary: `Ejecución no realizada: Claude no devolvió una decisión válida (${failure}).`.slice(0, 1000),
        tickers: [],
      });
      await writeSnapshot({ db: db!, exp, state, quotes: market.quotes, fx, kind: "run", runId, now });
      await finishRun(db!, runId!, "failed", { ...runMeta, error: failure, duration_ms: Date.now() - ctx.t0 });
    }
    process.exitCode = 1;
    return;
  }

  // 7. Motor de ejecución determinista.
  const instruments = new Map<string, Instrument>(
    market.universe.map((u) => [
      u.quote.symbol,
      {
        symbol: u.quote.symbol,
        name: u.quote.name,
        market: u.quote.market!,
        currency: u.quote.currency as Currency,
        kind: u.quote.quoteType === "ETF" ? "etf" : u.quote.quoteType === "CRYPTOCURRENCY" ? "crypto" : "stock",
        region: u.region,
      },
    ]),
  );
  const orders: OrderRequest[] = decision.orders.map((o) => ({
    symbol: o.symbol.toUpperCase(),
    side: o.side,
    quantity: o.quantity,
    type: o.type,
    limitPrice: o.limit_price,
    rationale: o.rationale,
  }));
  // Precio del momento de ejecución (no el de cuando se construyó el prompt).
  const execQuotes = new Map(market.quotes);
  const orderSymbols = [...new Set(orders.map((o) => o.symbol).filter((s) => instruments.has(s)))];
  if (orderSymbols.length) {
    try {
      const fresh = await provider.getQuotes([...orderSymbols, "EURUSD=X"]);
      for (const [s, q] of fresh) execQuotes.set(s, q);
      if (write) await insertQuotes(db!, quoteRows(fresh.values(), exp.id, runId));
    } catch (e) {
      log(`No se pudieron refrescar precios, se usan los del prompt: ${(e as Error).message}`);
    }
  }
  const execFx = fxFromQuotes(execQuotes);
  const out = executeOrders({ config: exp.config, now: new Date(), portfolio: state.portfolio, pending: state.pending, instruments, quotes: execQuotes, fx: execFx, orders });
  for (const r of [...out.results].sort((a, b) => a.index - b.index)) {
    log(`Orden ${r.index + 1}: ${r.request.side} ${r.request.quantity} ${r.request.symbol} (${r.request.type}) → ${r.status}${r.rejectReason ? `: ${r.rejectReason}` : ""}${r.fill ? ` a ${r.fill.priceLocal} ${r.fill.currency} (${r.fill.cashDeltaEur} €)` : ""}`);
  }

  // 8. Cambios de watchlist (validados con datos reales).
  const wlNotes: string[] = [];
  const toAdd = decision.watchlist_changes.filter((w) => w.action === "add").map((w) => w.symbol.toUpperCase());
  const addQuotes = toAdd.length ? await provider.getQuotes(toAdd) : new Map();
  let wlSize = watchlist.size;
  const wlRows: Record<string, unknown>[] = [];
  for (const w of decision.watchlist_changes) {
    const sym = w.symbol.toUpperCase();
    if (w.action === "remove") {
      if (watchlist.has(sym)) {
        wlRows.push({ symbol: sym, action: "remove", reason: w.reason });
        wlSize--;
      } else wlNotes.push(`${sym} no estaba en la watchlist`);
      continue;
    }
    const q = addQuotes.get(sym);
    if (watchlist.has(sym) || market.regions.has(sym)) wlNotes.push(`${sym} ya está en el universo`);
    else if (!q) wlNotes.push(`${sym} rechazado: sin cotización`);
    else if (!q.market || (q.currency !== "EUR" && q.currency !== "USD")) wlNotes.push(`${sym} rechazado: bolsa o divisa no permitida (${q.exchangeCode}, ${q.currency})`);
    else if (q.market === "CRYPTO" && !exp.config.allowCrypto) wlNotes.push(`${sym} rechazado: cripto desactivada`);
    else if (wlSize >= MAX_WATCHLIST_EXTRA) wlNotes.push(`${sym} rechazado: watchlist llena (${MAX_WATCHLIST_EXTRA})`);
    else {
      wlRows.push({ symbol: sym, action: "add", reason: w.reason });
      wlSize++;
    }
  }
  for (const n of wlNotes) log(`Watchlist: ${n}`);

  if (!write) {
    console.log("\n===== DECISIÓN (no guardada) =====\n" + JSON.stringify(decision, null, 2));
    const v = valuePortfolio(out.portfolio, prices, { USD: fx.USD?.rate });
    console.log(`\nCartera tras la ejecución simulada: efectivo ${v.cashEur} €, total ${v.totalEur} €`);
    return;
  }

  // 9. Persistencia: diario → órdenes → ejecuciones → watchlist → snapshot.
  const tickers = [...new Set([...orders.map((o) => o.symbol), ...wlRows.map((w) => String(w.symbol))])];
  await insertChained(db!, "journal_entries", {
    experiment_id: exp.id,
    run_id: runId,
    at: new Date(),
    kind: "decision",
    summary: decision.journal.summary,
    market_view: decision.journal.market_view,
    thesis: decision.journal.thesis,
    risks: decision.journal.risks,
    data_used: decision.journal.data_used,
    change_mind: decision.journal.change_mind,
    horizon: decision.journal.horizon,
    tickers,
  });
  for (const r of [...out.results].sort((a, b) => a.index - b.index)) {
    const q = r.quote;
    const row = await insertChained(db!, "orders", {
      experiment_id: exp.id,
      run_id: runId,
      idx: r.index,
      at: r.fill?.executedAt ?? new Date(),
      symbol: r.request.symbol,
      side: r.request.side,
      quantity: r.request.quantity,
      order_type: r.request.type,
      limit_price: r.request.limitPrice ?? null,
      rationale: r.request.rationale ?? null,
      status: r.status,
      reject_code: r.rejectCode ?? null,
      reject_reason: r.rejectReason ?? null,
      reserved_cash_eur: r.pending?.reservedCashEur ?? null,
      expires_at: r.pending?.expiresAt ?? null,
      quote_price: q?.price ?? null,
      quote_currency: q?.currency ?? null,
      quote_source: q?.source ?? null,
      quote_time: q?.quoteTime ?? null,
      quote_delay_s: q ? Math.round((q.fetchedAt.getTime() - q.quoteTime.getTime()) / 1000) : null,
      declared_delay_min: q?.declaredDelayMin ?? null,
    });
    if (r.fill) await insertFill(db!, exp.id, row.id, runId, r.fill);
  }
  for (const w of wlRows) await insertChained(db!, "watchlist_events", { experiment_id: exp.id, run_id: runId, at: new Date(), ...w });

  const finalState: LoadedState = { ...state, portfolio: out.portfolio, pending: out.pending };
  await writeSnapshot({ db: db!, exp, state: finalState, quotes: execQuotes, fx: execFx, kind: "run", runId, now: new Date() });
  const summary = {
    orders: out.results.length,
    filled: out.results.filter((r) => r.status === "filled").length,
    rejected: out.results.filter((r) => r.status === "rejected").length,
    pending: out.results.filter((r) => r.status === "pending").length,
    watchlist: wlRows.length,
    notes: [...pendingNotes, ...wlNotes],
  };
  await finishRun(db!, runId!, "completed", { ...runMeta, summary, duration_ms: Date.now() - ctx.t0 });
  log(`Ejecución completada: ${JSON.stringify(summary)}`);
}

main().catch((e) => {
  log(`ERROR FATAL: ${(e as Error).stack ?? e}`);
  process.exit(1);
});
