// Academia: cada viernes, tras el cierre, revisa la semana (post-mortem) y reescribe el MANUAL DE
// ESTRATEGIA que leen el gestor y la gestora de riesgos en cada ejecución. Así el equipo aprende
// de sus aciertos y errores con datos, en lugar de empezar de cero cada vez.
import { z } from "zod";
import { BENCHMARKS } from "@/core/benchmarks";
import { readAll, type Db, type Experiment } from "../db";
import { latestPlaybook, saveReport, callAgent } from "./team";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const text = (max: number) => z.string().trim().min(1).max(max);

export const AcademySchema = z
  .object({
    summary: text(500).describe("Balance de la semana en 2-3 frases"),
    grade: z.enum(["A", "B", "C", "D", "E"]).describe("Nota de la semana para el proceso de decisión (no solo el resultado)"),
    lessons: z
      .array(z.object({ title: text(100), evidence: text(500), lesson: text(500) }).strict())
      .min(1)
      .max(5),
    playbook: text(3000).describe("Manual de estrategia COMPLETO y actualizado: reglas concretas que seguirá el equipo la próxima semana"),
    changes: z.array(text(300)).max(6).describe("Qué cambia respecto al manual anterior y por qué"),
    experiments: z.array(text(300)).max(4).describe("Hipótesis a probar la próxima semana"),
  })
  .strict();
export type AcademyReport = z.infer<typeof AcademySchema>;

const SYSTEM = `Eres la ACADEMIA de un fondo de inversión simulado (dinero ficticio) gestionado por un equipo de IAs: gestor de cartera, analista cuantitativo y gestora de riesgos. Cada semana haces el post-mortem y mejoras la estrategia del equipo.
Reglas:
1. Usa SOLO los datos del mensaje. Distingue suerte de habilidad: con pocos días de datos, sé prudente y no saques conclusiones fuertes.
2. Evalúa el PROCESO (¿se siguieron las tesis, los límites, el manual?, ¿se operó de más o de menos?, ¿se cumplió el mandato de diversificación global?) y el RESULTADO frente a los benchmarks.
3. Escribe lecciones concretas con evidencia (cifras del mensaje).
4. Reescribe el MANUAL DE ESTRATEGIA completo (no solo los cambios): reglas claras y operativas sobre selección, tamaño de posiciones, horizontes (estratégico y táctico), cuándo salir, uso del efectivo, riesgo y costes. Mantén lo que funciona; cambia lo que los datos desaconsejan. Máximo 3000 caracteres.
5. El manual no puede contradecir las reglas duras del sistema (máx. 25 % por activo, solo contado, unidades enteras, solo EUR/USD) ni el mandato del propietario (buscar acciones de todo el mundo, no solo índices de EE. UU. y Europa).
6. Escribe en español y responde solo con el JSON del esquema.`;

/** Semana ISO (p. ej. 2026-W43) de una fecha YYYY-MM-DD. */
export function isoWeek(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86_400_000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const pc = (x: number) => `${(x * 100).toFixed(2)} %`;
const short = (s: unknown, n: number) => {
  const t = String(s ?? "");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function buildAcademyPrompt(args: {
  exp: Experiment;
  period: string;
  since: Date;
  snapshots: Row[];
  journal: Row[];
  orders: Row[];
  reports: Row[];
  previousPlaybook: string | null;
  previousLessons: string[];
}): string {
  const L: string[] = [];
  const cap = args.exp.config.initialCapital;
  L.push(`# Post-mortem de la semana ${args.period} (${args.exp.name})`);
  const snaps = args.snapshots;
  const first = snaps.find((s) => new Date(s.at) >= args.since) ?? snaps[0];
  const before = [...snaps].reverse().find((s) => new Date(s.at) < args.since) ?? first;
  const last = snaps.at(-1);
  if (before && last) {
    L.push("## RESULTADOS");
    L.push(`Desde el inicio: cartera ${Number(last.total_eur).toFixed(2)} € (${pc(Number(last.total_eur) / cap - 1)}).`);
    for (const b of BENCHMARKS) {
      const v = last.benchmarks?.[b.code];
      if (v !== undefined) L.push(`- ${b.name}: ${Number(v).toFixed(2)} € (${pc(Number(v) / cap - 1)})`);
    }
    L.push(`Esta semana: cartera ${pc(Number(last.total_eur) / Number(before.total_eur) - 1)}${BENCHMARKS.filter((b) => before.benchmarks?.[b.code]).map((b) => `, ${b.name} ${pc(Number(last.benchmarks[b.code]) / Number(before.benchmarks[b.code]) - 1)}`).join("")}.`);
    L.push("Valoraciones de la semana (fecha, tipo, total, efectivo):");
    for (const s of snaps.filter((x) => new Date(x.at) >= args.since)) L.push(`- ${String(s.at).slice(0, 16)} ${s.kind}: ${Number(s.total_eur).toFixed(2)} € (efectivo ${Number(s.cash_eur).toFixed(2)} €)`);
    L.push(`Posiciones actuales: ${((last.holdings ?? []) as Row[]).map((h) => `${h.symbol} ${((Number(h.valueEur) / Number(last.total_eur)) * 100).toFixed(1)} % (${((Number(h.valueEur) / Number(h.costEur) - 1) * 100).toFixed(1)} % vs coste)`).join(", ") || "ninguna"}`);
    L.push("");
  }
  const pm = [...args.reports].reverse().find((r) => r.agent === "quant_engine")?.content;
  if (pm?.postmortem?.trades?.length) {
    L.push("## POST-MORTEM DE OPERACIONES (desde cada operación, vs MSCI World)");
    L.push(`Acierto: ${pm.postmortem.hitRate === null ? "?" : pc(pm.postmortem.hitRate)}; exceso medio: ${pm.postmortem.avgExcess === null ? "?" : pc(pm.postmortem.avgExcess)}`);
    for (const t of pm.postmortem.trades as Row[])
      L.push(`- ${String(t.at).slice(0, 10)} ${t.side === "buy" ? "compra" : "venta"} ${t.symbol}: activo ${t.ret === null ? "?" : pc(t.ret)}, benchmark ${t.benchRet === null ? "?" : pc(t.benchRet)}, exceso ${t.excess === null ? "?" : pc(t.excess)}`);
    if (pm.risk) L.push(`Riesgo actual: volatilidad ${pc(pm.risk.annVol)}, VaR 95 % ${pc(pm.risk.var95_1d)}, beta ${pm.risk.beta ?? "?"}, máx. caída histórica ${pc(pm.risk.maxDrawdown)}`);
    L.push("");
  }
  L.push("## DECISIONES DE LA SEMANA (diario del gestor)");
  for (const j of args.journal) L.push(`- [${String(j.at).slice(0, 16)}] ${short(j.summary, 300)}${j.thesis ? ` | Tesis: ${short(j.thesis, 500)}` : ""}`);
  L.push("");
  L.push("## ÓRDENES DE LA SEMANA");
  if (!args.orders.length) L.push("Ninguna.");
  for (const o of args.orders) L.push(`- ${String(o.at).slice(0, 16)} ${o.side} ${o.quantity} ${o.symbol}: ${o.status}${o.reject_reason ? ` (${o.reject_reason})` : ""}`);
  L.push("");
  const memos = args.reports.filter((r) => r.agent === "quant_analyst" || r.agent === "risk_manager");
  if (memos.length) {
    L.push("## MEMOS DEL EQUIPO DE LA SEMANA");
    for (const r of memos) L.push(`- [${String(r.at).slice(0, 16)}] ${r.agent === "quant_analyst" ? "Analista cuantitativo" : "Gestora de riesgos"}: ${short(r.summary, 300)}`);
    L.push("");
  }
  L.push("## MANUAL DE ESTRATEGIA ANTERIOR");
  L.push(args.previousPlaybook ?? "No hay: es la primera semana. Redacta la primera versión.");
  if (args.previousLessons.length) {
    L.push("");
    L.push(`Lecciones de semanas anteriores: ${args.previousLessons.join(" | ")}`);
  }
  L.push("");
  L.push("Haz el post-mortem de la semana y devuelve el JSON con el manual actualizado.");
  return L.join("\n");
}

export async function runAcademy(args: { db: Db; exp: Experiment; day: string; log: (m: string) => void; dryRun?: boolean }): Promise<AcademyReport | null> {
  const { db, exp, log } = args;
  const period = isoWeek(args.day);
  const existing = await db.from("agent_reports").select("id").eq("experiment_id", exp.id).eq("agent", "academy").eq("period", period).limit(1);
  if (existing.data?.length && !args.dryRun) {
    log(`Academia: la semana ${period} ya estaba revisada.`);
    return null;
  }
  const d = new Date(`${args.day}T12:00:00Z`);
  const since = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000 - 12 * 3_600_000); // lunes 00:00 UTC
  const [snapshots, journalAll, ordersAll, reportsAll] = await Promise.all([
    readAll(db, "snapshots", exp.id, "seq"),
    readAll(db, "journal_entries", exp.id, "seq"),
    readAll(db, "orders", exp.id, "seq"),
    readAll(db, "agent_reports", exp.id, "seq"),
  ]);
  const inWeek = (r: Row) => new Date(r.at) >= since;
  const previous = await latestPlaybook(db, exp.id);
  const prompt = buildAcademyPrompt({
    exp,
    period,
    since,
    snapshots,
    journal: journalAll.filter((j) => inWeek(j) && (j.kind === "decision" || j.kind === "briefing")),
    orders: ordersAll.filter(inWeek),
    reports: reportsAll.filter(inWeek),
    previousPlaybook: previous?.playbook ?? null,
    previousLessons: reportsAll.filter((r) => r.agent === "academy").flatMap((r) => ((r.content?.lessons ?? []) as Row[]).map((l) => String(l.title))).slice(-12),
  });
  log(`Academia: revisando la semana ${period} (${prompt.length} caracteres)...`);
  const { value, durationMs } = await callAgent({ schema: AcademySchema, system: SYSTEM, prompt, model: exp.model });
  log(`Academia (${(durationMs / 1000).toFixed(1)} s): nota ${value.grade}. ${value.summary}`);
  if (!args.dryRun) await saveReport(db, { experimentId: exp.id, runId: null, agent: "academy", period, summary: value.summary, content: value, model: exp.model, durationMs });
  return value;
}
