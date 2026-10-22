import { MonteCarloChart, type FanPoint } from "@/components/MonteCarloChart";
import { Empty, NoExperiment, Section, Stat } from "@/components/ui";
import { getContext, loadData, type Row } from "@/lib/data";
import { fmtDate, fmtDateTime, fmtEur, fmtPct, tone } from "@/lib/format";
import { latestReport } from "@/lib/reports";

const n2 = (x: number | null | undefined) => (x === null || x === undefined ? "—" : x.toLocaleString("es-ES", { maximumFractionDigits: 2, minimumFractionDigits: 2 }));

function Explain({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-xs leading-relaxed text-muted">{children}</p>;
}

export default async function CuantitativoPage() {
  const { exp } = await getContext();
  if (!exp) return <NoExperiment />;
  const [d, report] = await Promise.all([loadData(exp), latestReport(exp.id, "quant_engine")]);
  if (!report) return <Empty>El motor cuantitativo aún no ha hecho ningún cálculo. Aparecerá tras la próxima ejecución.</Empty>;
  const q = report.content as Row;
  const total = d.latest ? Number(d.latest.total_eur) : Number(exp.initial_capital);
  const r = q.risk as Row | null;
  const b = q.benchRisk as Row | null;
  const mc = q.monteCarlo as Row | null;
  const bench = q.benchmark?.name ?? "MSCI World";

  return (
    <div className="space-y-4">
      <div className="card p-4 text-sm text-ink-2">
        <p>
          Esto lo calcula <strong className="text-ink">código, no la IA</strong>: son las fórmulas que usa un fondo cuantitativo, aplicadas a la cartera de hoy con los precios
          del último año ({q.days} sesiones, todo en euros). El analista cuantitativo y la gestora de riesgos leen estas cifras antes de cada decisión. Cálculo del{" "}
          {fmtDateTime(report.at)}.
        </p>
      </div>

      {r && (
        <Section title="Riesgo de la cartera actual">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label="Volatilidad anual" value={fmtPct(r.annVol, false, 1)} sub={`${bench}: ${fmtPct(b?.annVol, false, 1)}. Cuánto se mueve la cartera arriba y abajo en un año normal.`} />
            <Stat
              label="VaR 95 % (1 día)"
              value={fmtEur(r.var95_1d * total)}
              sub={`${fmtPct(r.var95_1d, false)} · Solo 1 de cada 20 días se perdería más que esto.`}
            />
            <Stat label="CVaR 95 % (1 día)" value={fmtEur(r.cvar95_1d * total)} sub={`${fmtPct(r.cvar95_1d, false)} · Pérdida media en ese 5 % de días malos.`} />
            <Stat label="Beta" value={n2(r.beta)} sub={`Si el ${bench} cae un 10 %, la cartera tiende a moverse un ${fmtPct((r.beta ?? 0) * -0.1, true, 1)}.`} />
            <Stat label="Máxima caída (último año)" value={fmtPct(r.maxDrawdown, true, 1)} valueClass="text-bad" sub={`${bench}: ${fmtPct(b?.maxDrawdown, true, 1)}. Peor caída desde un máximo.`} />
            <Stat label="Sharpe histórico" value={n2(r.sharpe)} sub={`${bench}: ${n2(b?.sharpe)}. Rentabilidad por unidad de riesgo (más alto, mejor).`} />
          </div>
          <Explain>
            Son cifras de cómo se habría comportado la cartera <em>actual</em> si se hubiera tenido todo el último año. Ojo: las acciones se eligieron sabiendo cómo les fue,
            así que la rentabilidad y el Sharpe pasados salen favorecidos; la volatilidad, el VaR y la beta son más fiables para medir el riesgo.
          </Explain>
        </Section>
      )}

      {mc && (
        <Section title="Monte Carlo: 5.000 futuros posibles a un año">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Escenario mediano a 1 año" value={fmtEur(mc.final.p50 * total)} sub={`${fmtPct(mc.final.p50 - 1)} · La mitad de los futuros acaba por encima.`} />
            <Stat label="Escenario malo (5 %)" value={fmtEur(mc.final.p5 * total)} valueClass="text-bad" sub={`${fmtPct(mc.final.p5 - 1)} · Solo 1 de cada 20 futuros es peor.`} />
            <Stat label="Probabilidad de perder dinero" value={fmtPct(mc.probLoss, false, 0)} sub={`De perder más de un 10 %: ${fmtPct(mc.probLoss10, false, 0)}`} />
            <Stat label={`Probabilidad de batir al ${bench}`} value={fmtPct(mc.probBeatBench, false, 0)} sub="Con la misma expectativa para los dos: depende de cuánto se separa la cartera del índice." />
          </div>
          <div className="mt-4">
            <MonteCarloChart fan={mc.fan as FanPoint[]} start={total} benchName={bench} />
          </div>
          <Explain>
            <strong>Cómo se calcula:</strong> se cogen trozos de 5 días reales del último año al azar y se encadenan hasta completar un año, 5.000 veces (bootstrap por bloques
            con semilla {mc.seed}, reproducible). Así se respetan las caídas y subidas reales y cómo se mueven juntas las acciones. <strong>No es una predicción:</strong> se le quita
            la tendencia del último año y se supone que la bolsa rinde un 5 % anual (el efectivo, 0 %), para medir sobre todo <em>cuánto puede oscilar</em> la cartera.
          </Explain>
        </Section>
      )}

      {(q.riskContributions as Row[]).length > 0 && (
        <Section title="¿De dónde viene el riesgo?">
          <div className="mb-3 flex flex-wrap gap-4 text-xs text-ink-2">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-4 rounded-full" style={{ background: "var(--s-cash)" }} /> Peso en la cartera
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-4 rounded-full" style={{ background: "var(--s-portfolio)" }} /> Parte del riesgo total
            </span>
          </div>
          <ul className="space-y-2.5">
            {(q.riskContributions as Row[]).map((c) => {
              const max = Math.max(...(q.riskContributions as Row[]).flatMap((x) => [x.weight, x.contribution]), 0.0001);
              return (
                <li key={c.symbol} className="grid grid-cols-[4.5rem_1fr] items-center gap-2 text-sm">
                  <span className="font-medium">{c.symbol}</span>
                  <div className="space-y-1">
                    <Bar value={c.weight / max} color="var(--s-cash)" label={`${fmtPct(c.weight, false, 1)} del dinero`} />
                    <Bar value={Math.max(c.contribution, 0) / max} color="var(--s-portfolio)" label={`${fmtPct(c.contribution, false, 1)} del riesgo · volatilidad ${fmtPct(c.vol, false, 0)}`} />
                  </div>
                </li>
              );
            })}
          </ul>
          <Explain>
            Si una posición aporta mucho más riesgo que dinero (barra azul más larga que la gris), es más arriesgada de lo que su peso aparenta. Ratio de diversificación:{" "}
            {n2(q.diversificationRatio)} (1 = nada diversificado; cuanto más alto, más se compensan unas posiciones con otras).
          </Explain>
          {(q.topCorrelations as Row[]).length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-muted">Parejas que más se mueven juntas (correlación: 1 = idénticas, 0 = independientes)</p>
              <ul className="mt-1 flex flex-wrap gap-2 text-sm">
                {(q.topCorrelations as Row[]).map((c) => (
                  <li key={`${c.a}-${c.b}`} className="rounded-md border border-line px-2 py-1">
                    {c.a} + {c.b}: <span className="num">{n2(c.corr)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {(q.stress as Row[]).length > 0 && (
        <Section title="Pruebas de estrés">
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Escenario (repetido con la cartera de hoy)</th>
                  <th>Periodo</th>
                  <th className="r">Cartera</th>
                  <th className="r">{bench}</th>
                </tr>
              </thead>
              <tbody>
                {(q.stress as Row[]).map((s) => (
                  <tr key={s.name}>
                    <td>{s.name}</td>
                    <td className="whitespace-nowrap text-muted">{s.from === s.to ? fmtDate(s.from) : `${fmtDate(s.from)} – ${fmtDate(s.to)}`}</td>
                    <td className={`r ${tone(s.portfolio)}`}>{fmtPct(s.portfolio)} · {fmtEur(s.portfolio * total)}</td>
                    <td className={`r ${tone(s.bench)}`}>{fmtPct(s.bench)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Explain>Qué pasaría con el dinero de hoy si se repitieran los peores momentos del último año.</Explain>
        </Section>
      )}

      {(q.postmortem?.trades as Row[] | undefined)?.length ? (
        <Section title="Post-mortem: ¿acertaron las operaciones?">
          <p className="text-sm text-ink-2">
            Acierto: <strong className="text-ink">{fmtPct(q.postmortem.hitRate, false, 0)}</strong> · Exceso medio frente al {bench}:{" "}
            <strong className={tone(q.postmortem.avgExcess)}>{fmtPct(q.postmortem.avgExcess)}</strong>
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Operación</th>
                  <th className="r">Activo desde entonces</th>
                  <th className="r">{bench}</th>
                  <th className="r">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {[...(q.postmortem.trades as Row[])].reverse().map((t, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap">{fmtDate(t.at)}</td>
                    <td>
                      {t.side === "buy" ? "Compra" : "Venta"} {t.symbol}
                    </td>
                    <td className={`r ${tone(t.ret)}`}>{fmtPct(t.ret)}</td>
                    <td className={`r ${tone(t.benchRet)}`}>{fmtPct(t.benchRet)}</td>
                    <td className={`r font-medium ${tone(t.excess)}`}>{fmtPct(t.excess)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Explain>
            Una compra es un acierto si desde entonces el activo lo ha hecho mejor que el {bench}; una venta, si lo ha hecho peor. Con pocas semanas es casi todo suerte: la
            academia lo revisa cada viernes.
          </Explain>
        </Section>
      ) : null}

      {(q.factors as Row[]).length > 0 && (
        <Section title="Ranking por factores (los 15 mejores del universo)">
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Activo</th>
                  <th>Región</th>
                  <th className="r">Nota</th>
                  <th className="r">Momentum</th>
                  <th className="r">Tendencia</th>
                  <th className="r">Baja vol.</th>
                  <th className="r">Valor</th>
                </tr>
              </thead>
              <tbody>
                {(q.factors as Row[]).slice(0, 15).map((f, i) => (
                  <tr key={f.symbol}>
                    <td className="text-muted">{i + 1}</td>
                    <td>
                      <span className="font-medium">{f.symbol}</span> {f.held && <span className="text-xs text-accent">· en cartera</span>}
                      <div className="text-xs text-muted">{f.name}</div>
                    </td>
                    <td className="text-ink-2">{f.region}</td>
                    <td className="r font-medium">{n2(f.score)}</td>
                    <td className={`r ${tone(f.momentum)}`}>{n2(f.momentum)}</td>
                    <td className={`r ${tone(f.trend)}`}>{n2(f.trend)}</td>
                    <td className={`r ${tone(f.lowVol)}`}>{n2(f.lowVol)}</td>
                    <td className={`r ${tone(f.value)}`}>{n2(f.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Explain>
            Cada activo recibe una nota en cuatro «factores» clásicos de los fondos cuantitativos: <strong>momentum</strong> (lo que subió en el último año, sin el último mes),{" "}
            <strong>tendencia</strong> (precio frente a su media de 200 sesiones), <strong>baja volatilidad</strong> (se mueve poco) y <strong>valor</strong> (barato respecto a sus
            beneficios esperados). Las cifras son desviaciones respecto a la media del universo: positivo = mejor que la media.
          </Explain>
        </Section>
      )}
    </div>
  );
}

function Bar({ value, color, label }: { value: number; color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 rounded-full bg-surface-2">
        <div className="h-2 rounded-full" style={{ width: `${Math.min(100, value * 100)}%`, background: color }} />
      </div>
      <span className="num w-56 shrink-0 text-xs text-ink-2 max-sm:w-40">{label}</span>
    </div>
  );
}
