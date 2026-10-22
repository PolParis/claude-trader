import Link from "next/link";
import { Office, type OfficeAgent } from "@/components/Office";
import { Empty, NoExperiment, Section, StatusBadge } from "@/components/ui";
import { getContext, loadData, type Row } from "@/lib/data";
import { fmtDateTime, fmtLong, fmtPct } from "@/lib/format";
import { academyReports } from "@/lib/reports";
import { nextScheduledRun } from "@/lib/schedule";
import { zonedParts } from "@/core/calendar";

const short = (s: string, n = 34) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

interface Card {
  id: string;
  name: string;
  role: string;
  ai: boolean;
  when: string;
  does: string;
  at?: string | null;
  summary?: string | null;
  details?: React.ReactNode;
}

export default async function OficinaPage() {
  const { supabase, exp } = await getContext();
  if (!exp) return <NoExperiment />;
  const d = await loadData(exp);
  const lastRun = [...d.runs].reverse().find((r) => r.kind !== "close" && r.status !== "failed");
  const lastClose = [...d.runs].reverse().find((r) => r.kind === "close");
  const [{ data: reportRows }, { data: explRows }, academy] = await Promise.all([
    lastRun ? supabase.from("agent_reports").select("*").eq("run_id", lastRun.id) : Promise.resolve({ data: [] as Row[] }),
    lastRun ? supabase.from("explanations").select("headline,at").eq("run_id", lastRun.id) : Promise.resolve({ data: [] as Row[] }),
    academyReports(exp.id),
  ]);
  const rep = new Map(((reportRows ?? []) as Row[]).map((r) => [r.agent, r]));
  const expl = ((explRows ?? []) as Row[])[0];
  const decision = lastRun ? d.journal.find((j) => j.run_id === lastRun.id && j.kind === "decision") : undefined;
  const orders = lastRun ? d.orders.filter((o) => o.run_id === lastRun.id) : [];
  const filled = orders.filter((o) => o.status === "filled").length;
  const rejected = orders.filter((o) => o.status === "rejected").length;
  const qe = rep.get("quant_engine")?.content as Row | undefined;
  const qa = rep.get("quant_analyst")?.content as Row | undefined;
  const rm = rep.get("risk_manager")?.content as Row | undefined;
  const ac = academy[0];

  // ¿Hay reunión ahora? (franjas de 16:30 y 21:00, de lunes a viernes)
  const now = new Date();
  const p = zonedParts(now, "Europe/Madrid");
  const mins = p.hour * 60 + p.minute;
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const live = weekday >= 1 && weekday <= 5 && ((mins >= 990 && mins < 1000) || (mins >= 1260 && mins < 1270));
  const caption = live
    ? "Reunión en curso"
    : lastRun
      ? `Repetición de la última reunión (${fmtDateTime(lastRun.reserved_at)}) · próxima: ${fmtLong(nextScheduledRun(now).at)}`
      : `Aún no ha habido reuniones · primera: ${fmtLong(nextScheduledRun(now).at)}`;

  const agents: OfficeAgent[] = [
    { id: "datos", name: "Recolectora", role: "Datos de mercado", ai: false, hair: "#2b2b2b", desk: { x: 110, y: 130 }, seat: { x: 460, y: 252 }, slot: [0, 0.16], bubble: "Datos de 160 activos listos" },
    { id: "motor", name: "Motor cuant", role: "Monte Carlo y riesgo", ai: false, hair: "#7a4b2a", desk: { x: 290, y: 130 }, seat: { x: 400, y: 252 }, slot: [0.12, 0.62], bubble: qe?.risk ? `Volatilidad ${fmtPct(qe.risk.annVol, false, 0)}, VaR ${fmtPct(qe.risk.var95_1d, false, 1)}` : "Calculando riesgos" },
    { id: "analista", name: "Analista cuant", role: "Ideas con datos", ai: true, hair: "#d9a441", desk: { x: 670, y: 130 }, seat: { x: 560, y: 252 }, slot: [0.2, 0.62], bubble: qa?.ideas?.[0] ? short(`${qa.ideas[0].action} ${qa.ideas[0].symbol} (${qa.ideas[0].horizon} plazo)`) : "Buscando oportunidades" },
    { id: "riesgos", name: "Gestora de riesgos", role: "Límites y alertas", ai: true, hair: "#5a2d1a", desk: { x: 850, y: 130 }, seat: { x: 620, y: 300 }, slot: [0.24, 0.66], bubble: rm ? `Riesgo ${rm.risk_level}` : "Revisando límites" },
    { id: "gestor", name: "Gestor de cartera", role: "Decide las órdenes", ai: true, hair: "#1f1f1f", desk: { x: 480, y: 450 }, seat: { x: 340, y: 300 }, slot: [0.08, 0.86], bubble: orders.length ? `${orders.length} ${orders.length === 1 ? "orden" : "órdenes"}. ¡Adelante!` : decision ? "Hoy no opero" : "Escuchando al equipo" },
    { id: "ejecucion", name: "Mesa de ejecución", role: "Motor de órdenes", ai: false, hair: "#9b9b9b", desk: { x: 110, y: 450 }, seat: { x: 430, y: 345 }, slot: [0.62, 0.82], bubble: orders.length ? `${filled} ejecutadas, ${rejected} rechazadas` : "Nada que ejecutar" },
    { id: "profesor", name: "Profesor", role: "Te lo explica", ai: true, hair: "#c0c0c0", desk: { x: 290, y: 450 }, seat: { x: 540, y: 345 }, slot: [0.74, 0.96], bubble: "Te lo explico en sencillo" },
    { id: "academia", name: "Academia", role: "Post-mortem semanal", ai: true, hair: "#8c2f39", desk: { x: 670, y: 450 }, seat: null, slot: null, bubble: null },
    { id: "auditor", name: "Auditor", role: "Cierre e integridad", ai: false, hair: "#3d5a80", desk: { x: 850, y: 450 }, seat: null, slot: null, bubble: null },
  ];

  const cards: Card[] = [
    {
      id: "datos",
      name: "Recolectora de datos",
      role: "Código",
      ai: false,
      when: "En cada reunión (16:30 y 21:00)",
      does: "Descarga de Yahoo Finance los precios de 160 activos, un año de histórico, índices de contexto, el EUR/USD y titulares. Calcula indicadores como el RSI o la distancia al máximo.",
      at: lastRun?.reserved_at,
      summary: lastRun ? `Informe para el gestor de ${(Number(lastRun.prompt_chars ?? 0) / 1000).toFixed(0)} mil caracteres.` : null,
    },
    {
      id: "motor",
      name: "Motor cuantitativo",
      role: "Código",
      ai: false,
      when: "En cada reunión",
      does: "Aplica las fórmulas de un fondo cuantitativo: volatilidad, VaR y CVaR, beta, 5.000 escenarios de Monte Carlo, pruebas de estrés, correlaciones, contribución al riesgo, ranking por factores y post-mortem de cada operación.",
      at: rep.get("quant_engine")?.at,
      summary: rep.get("quant_engine")?.summary,
      details: qe ? <Link href="/cuantitativo" className="text-accent">Ver todos los cálculos →</Link> : null,
    },
    {
      id: "analista",
      name: "Analista cuantitativo",
      role: "IA (Claude)",
      ai: true,
      when: "En cada reunión, antes del gestor",
      does: "Lee el informe del motor cuantitativo y propone hasta 8 ideas concretas con horizonte (corto, medio o largo plazo) y convicción del 1 al 5.",
      at: rep.get("quant_analyst")?.at,
      summary: qa?.summary,
      details: qa ? (
        <ul className="space-y-1">
          {(qa.ideas as Row[]).map((i) => (
            <li key={`${i.symbol}-${i.action}`}>
              <strong className="text-ink">
                {i.action} {i.symbol}
              </strong>{" "}
              <span className="text-muted">
                · {i.horizon} plazo · convicción {i.conviction}/5
              </span>
              <div>{i.reason}</div>
            </li>
          ))}
        </ul>
      ) : null,
    },
    {
      id: "riesgos",
      name: "Gestora de riesgos",
      role: "IA (Claude)",
      ai: true,
      when: "En cada reunión, antes del gestor",
      does: "Revisa el VaR, las concentraciones por activo, región y divisa y las correlaciones, y marca límites prudentes para esa ejecución.",
      at: rep.get("risk_manager")?.at,
      summary: rm ? `Riesgo ${rm.risk_level}. ${rm.summary}` : null,
      details: rm ? (
        <div className="space-y-2">
          <p>
            <strong className="text-ink">Presupuesto de riesgo:</strong> {rm.budget}
          </p>
          {(rm.limits as string[]).length > 0 && (
            <ul className="list-disc pl-5">
              {(rm.limits as string[]).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          {(rm.concerns as Row[]).length > 0 && (
            <ul className="list-disc pl-5">
              {(rm.concerns as Row[]).map((c, i) => (
                <li key={i}>
                  {c.symbol && <strong className="text-ink">{c.symbol}: </strong>}
                  {c.issue}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null,
    },
    {
      id: "gestor",
      name: "Gestor de cartera",
      role: "IA (Claude)",
      ai: true,
      when: "En cada reunión",
      does: "Escucha al equipo, sigue el manual de la academia (o explica por qué no) y decide las órdenes. Escribe su razonamiento en el diario.",
      at: decision?.at,
      summary: decision?.summary,
      details: decision ? <Link href="/diario" className="text-accent">Ver el diario completo →</Link> : null,
    },
    {
      id: "ejecucion",
      name: "Mesa de ejecución",
      role: "Código",
      ai: false,
      when: "Justo después del gestor",
      does: "Comprueba las reglas (mercado abierto, máximo 25 %, efectivo suficiente), vuelve a pedir el precio del momento y ejecuta con comisión y slippage. Lo que incumple las reglas se rechaza.",
      at: orders[0]?.at,
      summary: lastRun ? (orders.length ? `${orders.length} órdenes: ${filled} ejecutadas, ${rejected} rechazadas.` : "No hubo órdenes que ejecutar.") : null,
      details: orders.length ? (
        <ul className="space-y-1">
          {orders.map((o) => (
            <li key={o.id} className="flex flex-wrap gap-x-2">
              <StatusBadge status={o.status} />
              <span>
                {o.side === "buy" ? "Compra" : "Venta"} {o.quantity} {o.symbol}
              </span>
            </li>
          ))}
        </ul>
      ) : null,
    },
    {
      id: "profesor",
      name: "Profesor",
      role: "IA (Claude)",
      ai: true,
      when: "Al terminar cada reunión",
      does: "Explica en lenguaje sencillo lo que ha pasado y añade conceptos nuevos al glosario.",
      at: expl?.at,
      summary: expl?.headline,
      details: expl ? <Link href="/explicaciones" className="text-accent">Leer la explicación →</Link> : null,
    },
    {
      id: "academia",
      name: "Academia",
      role: "IA (Claude)",
      ai: true,
      when: "Viernes por la noche, tras el cierre",
      does: "Hace el post-mortem de la semana: compara cada decisión con el resultado, pone nota al proceso, escribe lecciones y reescribe el manual de estrategia que sigue el equipo.",
      at: ac?.at,
      summary: ac ? `Semana ${ac.period} · nota ${ac.content.grade}. ${ac.summary}` : "Su primera revisión será este viernes.",
    },
    {
      id: "auditor",
      name: "Auditor",
      role: "Código",
      ai: false,
      when: "Cada día a las 22:30",
      does: "Cierra el día: guarda la valoración final, revisa las órdenes limitadas, apunta dividendos y splits y comprueba que no falte ninguna ejecución. Todo queda en registros encadenados con hash.",
      at: lastClose?.finished_at ?? lastClose?.reserved_at,
      summary: lastClose ? `Último cierre: ${lastClose.run_date}.` : null,
      details: <Link href="/integridad" className="text-accent">Ver la integridad del registro →</Link>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="card p-4 text-sm text-ink-2">
        <p>
          El fondo funciona como un pequeño equipo. Cuatro «empleados» son <strong className="text-ink">IA (Claude)</strong> y cuatro son <strong className="text-ink">código</strong>{" "}
          que hace cálculos y aplica las reglas sin opinar. Se reúnen dos veces al día, a las 16:30 y a las 21:00. La reunión real dura unos 2 minutos; aquí la ves en bucle. Pulsa
          sobre un agente para ver qué ha hecho.
        </p>
      </div>

      <Section title="La oficina">
        <Office agents={agents} live={live} caption={caption} />
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((c) => (
          <section key={c.id} id={`agente-${c.id}`} className="card scroll-mt-20 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c.ai ? "var(--s-portfolio)" : "var(--s-cash)" }} aria-hidden />
              <h2 className="font-semibold">{c.name}</h2>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2">{c.role}</span>
              <span className="ml-auto text-xs text-muted">{c.when}</span>
            </div>
            <p className="mt-2 text-ink-2">{c.does}</p>
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-xs text-muted">Último trabajo{c.at ? ` · ${fmtDateTime(c.at)}` : ""}</p>
              <p className="mt-1">{c.summary ?? "Todavía nada."}</p>
              {c.details && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-accent">Ver detalle</summary>
                  <div className="mt-2 text-ink-2">{c.details}</div>
                </details>
              )}
            </div>
          </section>
        ))}
      </div>

      <Section title="Academia: manual de estrategia y lecciones">
        {!ac && <Empty>La academia hará su primera revisión este viernes por la noche, tras el cierre del mercado.</Empty>}
        {ac && (
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs text-muted">
                Manual vigente · semana {ac.period} · nota de la semana: <strong className="text-ink">{ac.content.grade}</strong>
              </p>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-sans text-ink-2">{ac.content.playbook}</pre>
            </div>
            {academy.map((a) => (
              <details key={a.id} className="rounded-lg border border-line p-3" open={a.id === ac.id}>
                <summary className="cursor-pointer font-medium">
                  Semana {a.period} · nota {a.content.grade}
                </summary>
                <p className="mt-2 text-ink-2">{a.summary}</p>
                <p className="mt-3 text-xs font-medium text-muted">Lecciones</p>
                <ul className="mt-1 space-y-2">
                  {(a.content.lessons as Row[]).map((l) => (
                    <li key={l.title}>
                      <strong>{l.title}.</strong> <span className="text-ink-2">{l.lesson}</span>
                      <div className="text-xs text-muted">Evidencia: {l.evidence}</div>
                    </li>
                  ))}
                </ul>
                {(a.content.changes as string[]).length > 0 && (
                  <>
                    <p className="mt-3 text-xs font-medium text-muted">Cambios en el manual</p>
                    <ul className="mt-1 list-disc pl-5 text-ink-2">
                      {(a.content.changes as string[]).map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </>
                )}
                {(a.content.experiments as string[]).length > 0 && (
                  <>
                    <p className="mt-3 text-xs font-medium text-muted">Hipótesis para la semana siguiente</p>
                    <ul className="mt-1 list-disc pl-5 text-ink-2">
                      {(a.content.experiments as string[]).map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </>
                )}
              </details>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
