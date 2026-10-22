// Explicación para principiantes: después de ejecutar, una segunda llamada a `claude -p`
// traduce la decisión (y lo que de verdad ocurrió con cada orden) a lenguaje sencillo.
// No influye en las órdenes: si falla, se registra en el log y la ejecución sigue siendo válida.
import { z } from "zod";
import { BASICS } from "@/lib/glossary";
import { insertChained, type Db, type Experiment } from "../db";
import { callClaude } from "./claude";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const text = (max: number) => z.string().trim().min(1).max(max);

export const ExplanationSchema = z
  .object({
    headline: text(160).describe("Titular de una frase, sin tecnicismos"),
    body: text(2500).describe("Explicación sencilla de 2-4 párrafos cortos"),
    operations: z
      .array(
        z
          .object({
            symbol: z.string().trim().min(1).max(20),
            what: text(200).describe("Qué es la empresa o el fondo, en una frase"),
            why: text(500).describe("Por qué se compró o vendió, en lenguaje sencillo"),
          })
          .strict(),
      )
      .max(20),
    concepts: z
      .array(z.object({ term: text(60), meaning: text(500) }).strict())
      .max(4)
      .describe("Conceptos de inversión que aparecen hoy y conviene aprender"),
    next_watch: text(500).describe("Qué vigilará Claude a partir de ahora, en lenguaje sencillo"),
  })
  .strict();

export type Explanation = z.infer<typeof ExplanationSchema>;

const SYSTEM = `Eres un profesor paciente que explica inversiones a un estudiante de ingeniería que NO sabe nada de bolsa. Es el dueño de un experimento en el que una IA (Claude) gestiona una cartera de dinero FICTICIO. Tu trabajo es explicarle, en español claro y cercano, qué ha decidido Claude en esta ejecución y por qué.

Reglas:
1. Lenguaje sencillo. Si usas un término técnico (PER, dividendo, ETF, volatilidad, momentum...), explícalo en la misma frase o inclúyelo en "concepts".
2. Cifras SOLO las del mensaje (precios, porcentajes, importes). Puedes usar conocimiento general para decir qué es una empresa o un fondo (por ejemplo "Petrobras es la petrolera estatal de Brasil"), pero nunca inventes precios, noticias ni resultados.
3. Si el mensaje incluye lo que dijo el equipo (motor cuantitativo, analista, gestora de riesgos), explica en sencillo qué aportó cada uno (por ejemplo qué significa el Monte Carlo o el VaR de hoy) y si el gestor les hizo caso.
4. Explica también lo que NO salió como Claude quería (órdenes rechazadas y su motivo) y por qué el sistema lo impidió.
5. Sé honesto: no prometas ganancias ni digas que una decisión es buena o mala con certeza. Es un experimento.
6. "operations": una entrada por cada activo comprado o vendido de verdad (no las rechazadas).
7. "concepts": de 0 a 4 conceptos NUEVOS que aparezcan hoy (indicadores, tipos de activo, términos del diario, reglas del experimento...); no repitas los de la lista "ya explicados". Explícalos con un ejemplo sencillo, a poder ser con cifras de hoy. Son para un glosario que el estudiante irá ampliando con el tiempo.
8. Usa ejemplos y comparaciones cotidianas cuando ayuden. Tutea al lector.
9. Responde solo con el JSON del esquema.`;

const eur = (x: unknown) => `${Number(x).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const pct = (x: number) => `${(x * 100).toLocaleString("es-ES", { maximumFractionDigits: 2 })} %`;

export function buildExplainPrompt(args: {
  initialCapital: number;
  runAt: string;
  journal: Row;
  orders: Row[];
  fills: Row[];
  instruments: Map<string, Row>;
  snapshot: Row | null;
  benchmarkNames: Record<string, string>;
  previous: Row[];
  knownConcepts: string[];
  team?: Row[];
}): string {
  const L: string[] = [];
  const name = (s: string) => {
    const i = args.instruments.get(s);
    return i ? `${s} (${i.name}; ${i.region ?? "?"}; ${i.kind === "etf" ? "fondo ETF" : "acción"})` : s;
  };
  L.push(`# Ejecución del ${args.runAt} (hora de Madrid)`);
  L.push(`Capital inicial del experimento: ${eur(args.initialCapital)}.`);
  L.push("");
  L.push("## Lo que escribió Claude en su diario (lenguaje técnico)");
  for (const [k, label] of [
    ["summary", "Resumen"],
    ["market_view", "Lectura del mercado"],
    ["thesis", "Tesis"],
    ["risks", "Riesgos"],
    ["change_mind", "Qué le haría cambiar de opinión"],
    ["horizon", "Horizonte"],
  ] as const)
    if (args.journal[k]) L.push(`${label}: ${args.journal[k]}`);
  L.push("");
  L.push("## Órdenes y qué pasó con cada una");
  if (!args.orders.length) L.push("Ninguna orden en esta ejecución.");
  for (const o of args.orders) {
    const f = args.fills.find((x) => x.order_id === o.id);
    const side = o.side === "buy" ? "Compra" : "Venta";
    let line = `- ${side} de ${o.quantity} ${name(o.symbol)} → `;
    if (o.status === "filled" && f)
      line += `EJECUTADA a ${f.price_local} ${f.currency} por unidad; importe ${eur(f.gross_eur)} + comisión ${eur(f.commission_eur)}`;
    else if (o.status === "rejected") line += `RECHAZADA por el sistema: ${o.reject_reason}`;
    else line += o.status === "pending" ? `PENDIENTE (orden con precio límite ${o.limit_price})` : o.status;
    L.push(line);
    if (o.rationale) L.push(`  Motivo de Claude: ${o.rationale}`);
  }
  L.push("");
  if (args.snapshot) {
    const s = args.snapshot;
    const total = Number(s.total_eur);
    L.push("## Cartera después de la ejecución");
    L.push(`Valor total ${eur(total)} (${pct(total / args.initialCapital - 1)} desde el inicio). Efectivo ${eur(s.cash_eur)} (${pct(Number(s.cash_eur) / total)}).`);
    for (const h of (s.holdings ?? []) as Row[]) L.push(`- ${name(h.symbol)}: ${h.quantity} uds, ${eur(h.valueEur)} (${pct(h.valueEur / total)} de la cartera)`);
    const bm = Object.entries((s.benchmarks ?? {}) as Record<string, number>)
      .map(([c, v]) => `${args.benchmarkNames[c] ?? c} ${eur(v)} (${pct(v / args.initialCapital - 1)})`)
      .join(" | ");
    if (bm) L.push(`Índices de referencia con el mismo dinero: ${bm}`);
    L.push("");
  }
  if (args.team?.length) {
    const names: Record<string, string> = { quant_engine: "Motor cuantitativo (código)", quant_analyst: "Analista cuantitativo", risk_manager: "Gestora de riesgos" };
    L.push("## LO QUE DIJO EL EQUIPO ANTES DE DECIDIR");
    for (const r of args.team) L.push(`- ${names[r.agent] ?? r.agent}: ${r.summary}`);
    L.push("");
  }
  if (args.previous.length) {
    L.push("## Titulares de tus explicaciones anteriores (para dar continuidad)");
    for (const p of args.previous) L.push(`- ${p.at.slice(0, 16).replace("T", " ")}: ${p.headline}`);
    L.push("");
  }
  L.push(`Conceptos ya explicados (no los repitas): ${args.knownConcepts.length ? args.knownConcepts.join(", ") : "ninguno todavía"}.`);
  L.push("");
  L.push("Explícale al estudiante esta ejecución. Devuelve el JSON.");
  return L.join("\n");
}

/** Genera y guarda la explicación de una ejecución. Devuelve false si no aplica (sin decisión). */
export async function explainRun(args: { db: Db; exp: Experiment; runId: string; benchmarkNames: Record<string, string>; log: (m: string) => void }): Promise<boolean> {
  const { db, exp, runId, log } = args;
  const one = async (table: string, q: (b: any) => any) => (await q(db.from(table).select("*"))).data as Row[] | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  const journal = (await one("journal_entries", (b) => b.eq("run_id", runId).eq("kind", "decision")))?.[0];
  if (!journal) return false;
  const orders = (await one("orders", (b) => b.eq("run_id", runId).order("idx"))) ?? [];
  const fills = (await one("fills", (b) => b.eq("run_id", runId))) ?? [];
  const snapshot = (await one("snapshots", (b) => b.eq("run_id", runId).order("seq", { ascending: false }).limit(1)))?.[0] ?? null;
  const team = (await one("agent_reports", (b) => b.eq("run_id", runId).order("seq"))) ?? [];
  const previousAll = (await one("explanations", (b) => b.eq("experiment_id", exp.id).order("seq"))) ?? [];
  const symbols = [...new Set([...orders.map((o) => o.symbol), ...((snapshot?.holdings ?? []) as Row[]).map((h) => h.symbol)])];
  const instr = symbols.length ? ((await db.from("instruments").select("*").in("symbol", symbols)).data ?? []) : [];

  const prompt = buildExplainPrompt({
    initialCapital: exp.config.initialCapital,
    runAt: new Date(journal.at).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "full", timeStyle: "short" }),
    journal,
    orders,
    fills,
    instruments: new Map((instr as Row[]).map((i) => [i.symbol, i])),
    snapshot,
    benchmarkNames: args.benchmarkNames,
    previous: previousAll.slice(-6),
    team,
    knownConcepts: [...new Set([...BASICS.map((b) => b.term), ...previousAll.flatMap((p) => ((p.concepts ?? []) as Row[]).map((c) => String(c.term)))])],
  });
  const schema = z.toJSONSchema(ExplanationSchema, { target: "draft-7" }) as Record<string, unknown>;
  delete schema.$schema;
  log(`Explicación: llamando a claude -p (${exp.model})...`);
  const res = await callClaude({ prompt, systemPrompt: SYSTEM, jsonSchema: JSON.stringify(schema), model: exp.model });
  if (!res.ok) throw new Error(res.error);
  const parsed = ExplanationSchema.safeParse(res.output);
  if (!parsed.success) throw new Error(`Explicación no válida: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const e = parsed.data;
  await insertChained(db, "explanations", {
    experiment_id: exp.id,
    run_id: runId,
    at: new Date(),
    headline: e.headline,
    body: e.body,
    operations: e.operations,
    concepts: e.concepts,
    next_watch: e.next_watch,
    model: exp.model,
  });
  log(`Explicación guardada en ${(res.durationMs / 1000).toFixed(1)} s: ${e.headline}`);
  return true;
}
