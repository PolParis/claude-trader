import { BENCHMARKS } from "@/core/benchmarks";
import { annualizedReturn, annualizedVolatility, daysBetween, maxDrawdown, sharpeRatio, totalReturn, turnover, winRate, type SeriesPoint } from "@/core/metrics";
import { NoExperiment, Section, Stat, StatusBadge } from "@/components/ui";
import { getContext, loadData } from "@/lib/data";
import { fmtDate, fmtDateTime, fmtEur, fmtNum, fmtPct, tone } from "@/lib/format";

function metricsFor(series: SeriesPoint[], initial: number, days: number, rf: number) {
  const last = series.at(-1)?.value ?? initial;
  return {
    total: totalReturn(initial, last),
    annual: annualizedReturn(initial, last, days),
    vol: annualizedVolatility(series),
    sharpe: sharpeRatio(series, rf),
    dd: maxDrawdown(series),
  };
}

export default async function MetricasPage() {
  const { exp } = await getContext();
  if (!exp) return <NoExperiment />;
  const d = await loadData(exp);
  const initial = Number(exp.initial_capital);
  const rf = Number(exp.risk_free_rate);
  const days = exp.started_at ? daysBetween(new Date(exp.started_at), new Date()) : 0;
  const rows = [
    { name: "Cartera de Claude", m: metricsFor(d.daily, initial, days, rf), main: true },
    ...BENCHMARKS.map((b) => ({ name: b.name, m: metricsFor(d.dailyBenchmarks[b.code] ?? [], initial, days, rf), main: false })),
  ];
  const p = d.portfolio;
  const wr = winRate(p.closedTrades);
  const to = turnover(p.turnoverEur, d.daily);
  const agentRuns = d.runs.filter((r) => r.kind !== "close" && r.kind !== "start");
  const count = (s: string) => agentRuns.filter((r) => r.status === s).length;
  const shortPeriod = days < 30;

  return (
    <div className="space-y-4">
      {shortPeriod && (
        <p className="rounded-md bg-warn-bg px-3 py-2 text-xs text-warn-ink">
          Solo llevamos {fmtNum(Math.floor(days))} días de experimento: la rentabilidad anualizada no se calcula hasta los 30 días, y la volatilidad y el Sharpe son poco fiables con tan pocos datos.
        </p>
      )}
      <Section title="Rendimiento y riesgo">
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Serie</th>
                <th className="r">Rentabilidad total</th>
                <th className="r">Anualizada</th>
                <th className="r">Volatilidad anual</th>
                <th className="r">Sharpe</th>
                <th className="r">Máx. drawdown</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ name, m, main }) => (
                <tr key={name} className={main ? "font-medium" : ""}>
                  <td>{name}</td>
                  <td className={`r ${tone(m.total)}`}>{fmtPct(m.total)}</td>
                  <td className={`r ${tone(m.annual)}`}>{fmtPct(m.annual)}</td>
                  <td className="r">{fmtPct(m.vol, false)}</td>
                  <td className="r">{m.sharpe === null ? "—" : m.sharpe.toLocaleString("es-ES", { maximumFractionDigits: 2 })}</td>
                  <td className="r">
                    {fmtPct(m.dd.pct)}
                    {m.dd.troughDate && <div className="text-xs font-normal text-muted">{fmtDate(m.dd.peakDate)} → {fmtDate(m.dd.troughDate)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          Calculado con un valor por día (cierre). Volatilidad y Sharpe anualizados con 252 sesiones; tipo libre de riesgo {fmtPct(rf, false)}.
        </p>
      </Section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Operaciones cerradas ganadoras" value={wr === null ? "—" : fmtPct(wr, false, 0)} sub={`${p.closedTrades.length} ventas con P&L realizado`} />
        <Stat label="P&L realizado" value={fmtEur(p.realizedPnlEur)} valueClass={tone(p.realizedPnlEur)} sub={`Dividendos: ${fmtEur(p.dividendsEur)}`} />
        <Stat label="Rotación" value={to === null ? "—" : `${to.toLocaleString("es-ES", { maximumFractionDigits: 2 })}×`} sub={`Negociado: ${fmtEur(p.turnoverEur)}`} />
        <Stat label="Comisiones pagadas" value={fmtEur(p.commissionsEur + p.fxFeesEur)} sub={`${d.fills.length} ejecuciones`} />
      </div>

      <Section title="Ejecuciones del agente">
        <div className="mb-3 grid grid-cols-3 gap-3 text-center">
          <div><p className="num text-xl font-semibold">{count("completed")}</p><StatusBadge status="completed" /></div>
          <div><p className="num text-xl font-semibold">{count("failed")}</p><StatusBadge status="failed" /></div>
          <div><p className="num text-xl font-semibold">{count("skipped")}</p><StatusBadge status="skipped" /></div>
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Franja</th>
                <th>Estado</th>
                <th>Equipo</th>
                <th className="r">Duración</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {[...d.runs].reverse().map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(r.reserved_at)}</td>
                  <td>{r.kind === "close" ? "Cierre" : r.kind === "manual" ? `Manual (${r.slot.slice(1, 3)}:${r.slot.slice(3)})` : r.slot === "S1" ? "16:30" : "21:00"}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="text-xs text-muted">{r.hostname}</td>
                  <td className="r">{r.duration_ms ? `${Math.round(r.duration_ms / 1000)} s` : "—"}</td>
                  <td className="max-w-xs text-xs text-muted">
                    {r.error ? String(r.error).split("\n")[0].slice(0, 160) : r.summary?.orders !== undefined ? `${r.summary.orders} órdenes · ${r.summary.filled} ejecutadas · ${r.summary.rejected} rechazadas` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
