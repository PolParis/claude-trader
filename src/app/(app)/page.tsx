import Link from "next/link";
import { BENCHMARKS } from "@/core/benchmarks";
import { PerformanceChart } from "@/components/PerformanceChart";
import { NoExperiment, Section, Stat, StatusBadge } from "@/components/ui";
import { getContext, loadData } from "@/lib/data";
import { fmtDateTime, fmtEur, fmtLong, fmtPct, tone } from "@/lib/format";
import { nextScheduledRun } from "@/lib/schedule";
import { CHART_SERIES } from "@/lib/series";

export default async function ResumenPage() {
  const { exp } = await getContext();
  if (!exp) return <NoExperiment />;
  const d = await loadData(exp);
  const initial = Number(exp.initial_capital);
  const total = d.latest ? Number(d.latest.total_eur) : initial;
  const cash = d.latest ? Number(d.latest.cash_eur) : initial;
  const ret = total / initial - 1;
  const next = nextScheduledRun(new Date());
  const lastRun = [...d.runs].reverse().find((r) => r.kind !== "close");
  const lastDecision = [...d.journal].reverse().find((j) => j.kind === "decision");

  return (
    <div className="space-y-4">
      {!exp.started_at && (
        <div className="card p-4 text-sm text-ink-2">
          El experimento <strong>{exp.name}</strong> aún no ha empezado. Empezará en la primera ejecución con los mercados europeos abiertos.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Valor de la cartera" value={fmtEur(total)} sub={d.latest ? `Valorada el ${fmtDateTime(d.latest.at)}` : "Sin valoraciones todavía"} />
        <Stat label="Rentabilidad total" value={fmtPct(ret)} valueClass={tone(ret)} sub={`Desde ${exp.started_at ? fmtDateTime(exp.started_at) : "—"}`} />
        <Stat label="Efectivo" value={fmtEur(cash)} sub={`${fmtPct(cash / total, false, 1)} de la cartera`} />
        <Stat label="Próxima ejecución programada" value={<span className="text-base">{fmtLong(next.at)}</span>} sub={lastRun ? <>Última: {fmtDateTime(lastRun.reserved_at)} · <StatusBadge status={lastRun.status} /></> : "Sin ejecuciones todavía"} />
      </div>

      <Section title="Frente a los benchmarks">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {BENCHMARKS.map((b) => {
            const v = d.latest?.benchmarks?.[b.code];
            const bret = v !== undefined ? Number(v) / initial - 1 : null;
            const diff = bret !== null ? ret - bret : null;
            return (
              <div key={b.code} className="rounded-lg border border-line p-3">
                <p className="text-xs text-muted">{b.name}</p>
                <p className="num mt-1 text-sm">{v !== undefined ? `${fmtEur(Number(v))} · ${fmtPct(bret)}` : "—"}</p>
                <p className={`num mt-1 text-sm font-semibold ${tone(diff)}`}>
                  {diff === null ? "—" : `${diff >= 0 ? "▲" : "▼"} Claude ${fmtPct(diff)}`}
                </p>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted">Diferencia en puntos de rentabilidad: positivo = Claude va por delante.</p>
      </Section>

      <Section title="Evolución de la cartera y de los benchmarks">
        <PerformanceChart data={d.chart} series={CHART_SERIES} initial={initial} />
      </Section>

      {lastDecision && (
        <Section title="Última decisión de Claude" actions={<Link href="/diario" className="text-xs text-accent">Ver diario →</Link>}>
          <p className="text-xs text-muted">{fmtDateTime(lastDecision.at)}</p>
          <p className="mt-1 text-sm">{lastDecision.summary}</p>
        </Section>
      )}
    </div>
  );
}
