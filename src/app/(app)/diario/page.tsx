import { madridDate } from "@/core/calendar";
import { Empty, NoExperiment, StatusBadge } from "@/components/ui";
import { getContext, loadData, type Row } from "@/lib/data";
import { fmtDateTime, fmtNum, fmtPrice } from "@/lib/format";
import { buildTradeRows, rejectLabel } from "@/lib/trades";

const KIND: Record<string, string> = { decision: "Decisión", run_failed: "Ejecución fallida", run_skipped: "Ejecución omitida", system: "Sistema" };

export default async function DiarioPage({ searchParams }: PageProps<"/diario">) {
  const { exp } = await getContext();
  if (!exp) return <NoExperiment />;
  const sp = await searchParams;
  const from = typeof sp.desde === "string" ? sp.desde : "";
  const to = typeof sp.hasta === "string" ? sp.hasta : "";
  const ticker = typeof sp.activo === "string" ? sp.activo.trim().toUpperCase() : "";
  const d = await loadData(exp);
  const trades = buildTradeRows(d.orders, d.fills, d.orderEvents);
  const byRun = new Map<string, typeof trades>();
  for (const t of trades) {
    const k = t.order.run_id;
    if (!k) continue;
    byRun.set(k, [...(byRun.get(k) ?? []), t]);
  }
  const allTickers = [...new Set(d.journal.flatMap((j) => (j.tickers ?? []) as string[]))].sort();
  const entries = [...d.journal]
    .reverse()
    .filter((j) => (!from || madridDate(new Date(j.at)) >= from) && (!to || madridDate(new Date(j.at)) <= to))
    .filter((j) => !ticker || (j.tickers ?? []).includes(ticker) || `${j.thesis ?? ""} ${j.summary}`.toUpperCase().includes(ticker));

  return (
    <div className="space-y-4">
      <form className="card flex flex-wrap items-end gap-3 p-4 text-sm" method="get">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Desde</span>
          <input type="date" name="desde" defaultValue={from} className="rounded-md border border-line bg-surface-2 px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Hasta</span>
          <input type="date" name="hasta" defaultValue={to} className="rounded-md border border-line bg-surface-2 px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Activo</span>
          <input name="activo" list="tickers" defaultValue={ticker} placeholder="p. ej. NVDA" className="w-32 rounded-md border border-line bg-surface-2 px-2 py-1" />
          <datalist id="tickers">
            {allTickers.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <button className="rounded-md bg-accent px-3 py-1.5 text-white">Filtrar</button>
        {(from || to || ticker) && (
          <a href="/diario" className="px-2 py-1.5 text-xs text-accent">
            Quitar filtros
          </a>
        )}
        <span className="ml-auto text-xs text-muted">{entries.length} entradas</span>
      </form>

      {entries.length === 0 && <Empty>No hay entradas que coincidan.</Empty>}
      {entries.map((j) => (
        <Entry key={j.id} j={j} trades={j.run_id ? (byRun.get(j.run_id) ?? []) : []} />
      ))}
    </div>
  );
}

function Entry({ j, trades }: { j: Row; trades: ReturnType<typeof buildTradeRows> }) {
  const fields: [string, string | null][] = [
    ["Lectura del mercado", j.market_view],
    ["Tesis", j.thesis],
    ["Riesgos", j.risks],
    ["Datos usados", j.data_used],
    ["Qué me haría cambiar de opinión", j.change_mind],
    ["Horizonte", j.horizon],
  ];
  return (
    <article className="card p-4">
      <header className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>{fmtDateTime(j.at)}</span>
        <span className={`rounded px-1.5 py-0.5 ${j.kind === "decision" ? "bg-surface-2 text-ink-2" : "bg-warn-bg text-warn-ink"}`}>{KIND[j.kind] ?? j.kind}</span>
        {(j.tickers ?? []).map((t: string) => (
          <a key={t} href={`/diario?activo=${encodeURIComponent(t)}`} className="rounded border border-line px-1.5 py-0.5 hover:bg-surface-2">
            {t}
          </a>
        ))}
        <span className="ml-auto font-mono" title={`Hash: ${j.hash}`}>#{j.seq} · {String(j.hash).slice(0, 10)}…</span>
      </header>
      <p className="mt-2 font-medium">{j.summary}</p>
      {j.kind === "decision" && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-xs text-accent">Ver el razonamiento completo</summary>
          <dl className="mt-2 space-y-2">
            {fields
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs font-medium text-muted">{k}</dt>
                  <dd className="whitespace-pre-line text-ink-2">{v}</dd>
                </div>
              ))}
          </dl>
        </details>
      )}
      {trades.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          {trades
            .slice()
            .sort((a, b) => a.order.idx - b.order.idx)
            .map(({ order: o, fill: f, status }) => (
              <li key={o.id} className="flex flex-wrap items-baseline gap-x-2">
                <StatusBadge status={status} />
                <span className="font-medium">
                  {o.side === "buy" ? "Compra" : "Venta"} {fmtNum(Number(o.quantity))} {o.symbol}
                </span>
                {f && <span className="text-xs text-muted">a {fmtPrice(Number(f.price_local), f.currency)}</span>}
                {status === "rejected" && <span className="text-xs text-bad">{rejectLabel(o.reject_code)}</span>}
                {o.rationale && <span className="w-full text-xs text-ink-2">{o.rationale}</span>}
              </li>
            ))}
        </ul>
      )}
    </article>
  );
}
