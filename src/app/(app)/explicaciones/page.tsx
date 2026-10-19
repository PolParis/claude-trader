import Link from "next/link";
import { PerformanceChart } from "@/components/PerformanceChart";
import { Empty, NoExperiment, Section, StatusBadge } from "@/components/ui";
import { allocation, type Slice } from "@/lib/allocation";
import { getContext, loadData, type Row } from "@/lib/data";
import { fmtEur, fmtLong, fmtNum, fmtPct, tone } from "@/lib/format";
import { CHART_SERIES } from "@/lib/series";

// Conceptos básicos fijos; los que Claude explica en cada ejecución se añaden debajo.
const BASICS: { term: string; meaning: string }[] = [
  { term: "Acción", meaning: "Un trozo pequeño de una empresa. Si a la empresa le va bien y más gente quiere sus acciones, el precio sube; si le va mal, baja." },
  { term: "Fondo indexado o ETF", meaning: "Una cesta que contiene muchas acciones a la vez (por ejemplo, las 500 mayores empresas de EE. UU.). Comprar una cesta reparte el riesgo: si una empresa se hunde, las otras compensan." },
  { term: "Índice de referencia (benchmark)", meaning: "Lo que habría conseguido alguien que el primer día metió los 10.000 € en un fondo indexado y no hizo nada más. Claude intenta hacerlo mejor que eso." },
  { term: "Rentabilidad", meaning: "Cuánto ha ganado o perdido la cartera en porcentaje. +5 % sobre 10.000 € son 500 € de ganancia." },
  { term: "Comisión y slippage", meaning: "Lo que cuesta cada operación: una comisión del 0,10 % (mínimo 1 €) y un pequeño sobreprecio (0,05 %) por no comprar exactamente al precio de pantalla. Operar mucho sale caro." },
  { term: "Diversificar", meaning: "No poner todos los huevos en la misma cesta: repartir el dinero entre países, sectores y tipos de activo para que un mal golpe en uno no hunda todo." },
  { term: "Riesgo de divisa", meaning: "Muchas acciones cotizan en dólares. Si el euro sube frente al dólar, esas acciones valen menos euros aunque su precio en dólares no cambie." },
];

// Evita repetir en el glosario un concepto que ya está entre los básicos (p. ej. "ETF").
const stem = (t: string) => t.toLowerCase().slice(0, 6);
const isBasic = (term: string) => BASICS.some((b) => stem(b.term) === stem(term) || b.term.toLowerCase().includes(term.toLowerCase()));

export default async function ExplicacionesPage() {
  const { supabase, exp } = await getContext();
  if (!exp) return <NoExperiment />;
  const d = await loadData(exp);
  const { data } = await supabase.from("explanations").select("*").eq("experiment_id", exp.id).order("seq", { ascending: false });
  const explanations = (data ?? []) as Row[];
  const runs = new Map(d.runs.map((r) => [r.id, r]));
  const ordersByRun = new Map<string, Row[]>();
  for (const o of d.orders) if (o.run_id) ordersByRun.set(o.run_id, [...(ordersByRun.get(o.run_id) ?? []), o]);

  const initial = Number(exp.initial_capital);
  const latest = d.latest;
  const a = latest ? allocation(latest.holdings ?? [], Number(latest.cash_eur), d.instruments) : null;
  const ret = latest ? Number(latest.total_eur) / initial - 1 : 0;

  const learned = new Map<string, { meaning: string; at: string }>();
  for (const e of [...explanations].reverse())
    for (const c of (e.concepts ?? []) as Row[]) if (!learned.has(c.term) && !isBasic(c.term)) learned.set(c.term, { meaning: c.meaning, at: e.at });

  return (
    <div className="space-y-4">
      <div className="card p-4 text-sm text-ink-2">
        <p>
          Aquí Claude te explica <strong className="text-ink">en lenguaje sencillo</strong> qué hace con la cartera y por qué. Después de cada ejecución escribe una
          explicación nueva, así que puedes leer la historia completa desde el primer día. El razonamiento técnico original está en el{" "}
          <Link href="/diario" className="text-accent">Diario de Claude</Link>.
        </p>
      </div>

      {latest && a && (
        <Section title="¿Cómo va?">
          <p className="text-sm text-ink-2">
            Claude empezó con {fmtEur(initial)}. Ahora la cartera vale <strong className="text-ink">{fmtEur(Number(latest.total_eur))}</strong>, un{" "}
            <strong className={tone(ret)}>{fmtPct(ret)}</strong>. La línea azul es Claude; las demás, lo que habría pasado con el mismo dinero metido en un fondo
            indexado sin hacer nada. Si la azul va por encima, Claude va ganando.
          </p>
          <div className="mt-3">
            <PerformanceChart data={d.chart} series={CHART_SERIES} initial={initial} />
          </div>
        </Section>
      )}

      {a && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="¿En qué países está tu dinero?">
            <Bars slices={a.byZone} />
            <p className="mt-3 text-xs text-muted">
              Un {fmtPct(a.usdShare, false, 0)} de la cartera está en activos en dólares: si el euro sube frente al dólar, esa parte pierde algo de valor al pasarla a euros.
            </p>
          </Section>
          <Section title="¿En qué tipo de cosas?">
            <Bars slices={a.byType} />
            <p className="mt-3 text-xs text-muted">
              Las acciones de una sola empresa pueden subir o bajar mucho más que los fondos, que reparten el riesgo entre cientos de empresas. El efectivo no gana ni
              pierde, pero permite aprovechar oportunidades.
            </p>
          </Section>
        </div>
      )}

      <Section title="Historia de las decisiones">
        {explanations.length === 0 && <Empty>Todavía no hay explicaciones. Aparecerán después de la próxima ejecución.</Empty>}
        <div className="space-y-4">
          {explanations.map((e) => (
            <Story key={e.id} e={e} run={runs.get(e.run_id)} orders={ordersByRun.get(e.run_id) ?? []} />
          ))}
        </div>
      </Section>

      <Section title="Glosario">
        <dl className="grid gap-3 text-sm md:grid-cols-2">
          {BASICS.map((c) => (
            <div key={c.term}>
              <dt className="font-medium text-ink">{c.term}</dt>
              <dd className="text-ink-2">{c.meaning}</dd>
            </div>
          ))}
          {[...learned].map(([term, c]) => (
            <div key={term}>
              <dt className="font-medium text-ink">{term}</dt>
              <dd className="text-ink-2">{c.meaning}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}

function Bars({ slices }: { slices: Slice[] }) {
  const max = Math.max(...slices.map((s) => s.share), 0.0001);
  return (
    <ul className="space-y-2.5">
      {slices.map((s) => (
        <li key={s.label} className="text-sm" title={s.symbols.length ? s.symbols.join(", ") : undefined}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-ink">{s.label}</span>
            <span className="num whitespace-nowrap text-ink-2">
              {fmtPct(s.share, false, 1)} · {fmtEur(s.valueEur)}
            </span>
          </div>
          <div className="mt-1 h-2 w-full rounded-full bg-surface-2">
            <div
              className="h-2 rounded-full"
              style={{ width: `${(s.share / max) * 100}%`, background: s.label === "Efectivo" ? "var(--s-cash)" : "var(--s-portfolio)" }}
            />
          </div>
          {s.symbols.length > 0 && <p className="mt-0.5 text-xs text-muted">{s.symbols.join(" · ")}</p>}
        </li>
      ))}
    </ul>
  );
}

function Story({ e, run, orders }: { e: Row; run: Row | undefined; orders: Row[] }) {
  const ops = (e.operations ?? []) as Row[];
  const concepts = (e.concepts ?? []) as Row[];
  const rejected = orders.filter((o) => o.status === "rejected");
  const when = run?.reserved_at ?? e.at;
  return (
    <article className="border-l-2 border-accent pl-4">
      <p className="text-xs capitalize text-muted">
        {fmtLong(new Date(when))}
        {run?.slot === "S1" ? " · ejecución de la tarde" : run?.slot === "S2" ? " · ejecución de la noche" : ""}
      </p>
      <h3 className="mt-1 font-semibold text-ink">{e.headline}</h3>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-ink-2">
        {String(e.body)
          .split(/\n+/)
          .filter(Boolean)
          .map((p, i) => (
            <p key={i}>{p}</p>
          ))}
      </div>

      {(ops.length > 0 || rejected.length > 0) && (
        <div className="mt-3">
          <p className="text-xs font-medium text-muted">Qué ha comprado o vendido y por qué</p>
          <ul className="mt-1 space-y-2 text-sm">
            {ops.map((op) => {
              const o = orders.find((x) => x.symbol === op.symbol && x.status !== "rejected");
              return (
                <li key={op.symbol} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    {o && <StatusBadge status={o.status} />}
                    <span className="font-medium text-ink">
                      {o ? `${o.side === "buy" ? "Compra" : "Venta"} de ${fmtNum(Number(o.quantity))} ` : ""}
                      {op.symbol}
                    </span>
                    <span className="text-xs text-muted">{op.what}</span>
                  </div>
                  <p className="mt-1 text-ink-2">{op.why}</p>
                </li>
              );
            })}
            {rejected.map((o) => (
              <li key={o.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <StatusBadge status="rejected" />
                  <span className="font-medium text-ink">
                    {o.side === "buy" ? "Compra" : "Venta"} de {fmtNum(Number(o.quantity))} {o.symbol}
                  </span>
                </div>
                <p className="mt-1 text-ink-2">El sistema no la dejó pasar: {o.reject_reason}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {concepts.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs text-accent">Conceptos que aparecen hoy ({concepts.length})</summary>
          <dl className="mt-2 space-y-2">
            {concepts.map((c) => (
              <div key={c.term}>
                <dt className="font-medium text-ink">{c.term}</dt>
                <dd className="text-ink-2">{c.meaning}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      {e.next_watch && (
        <p className="mt-3 rounded-lg bg-surface-2 p-3 text-sm text-ink-2">
          <span className="font-medium text-ink">Qué vigilará a partir de ahora: </span>
          {e.next_watch}
        </p>
      )}
    </article>
  );
}
