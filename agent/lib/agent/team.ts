// Equipo de agentes que trabajan ANTES de que el gestor decida. Cada uno es una llamada
// independiente a `claude -p` (sin herramientas ni red) con su propio papel:
//  - Analista cuantitativo: lee el informe matemático y propone ideas concretas.
//  - Gestora de riesgos: revisa el riesgo de la cartera y marca límites.
// Son asesores: si fallan, el gestor decide igualmente con el informe cuantitativo en bruto.
import { z } from "zod";
import type { ExperimentConfig } from "@/core/types";
import { insertChained, type Db } from "../db";
import { callClaude } from "./claude";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const text = (max: number) => z.string().trim().min(1).max(max);

function jsonSchema(schema: z.ZodType): string {
  const s = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete s.$schema;
  return JSON.stringify(s);
}

export async function callAgent<T>(args: { schema: z.ZodType<T>; system: string; prompt: string; model: string }): Promise<{ value: T; durationMs: number }> {
  const res = await callClaude({ prompt: args.prompt, systemPrompt: args.system, jsonSchema: jsonSchema(args.schema), model: args.model });
  if (!res.ok) throw new Error(res.error);
  const parsed = args.schema.safeParse(res.output);
  if (!parsed.success) throw new Error(`Respuesta no válida: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return { value: parsed.data, durationMs: res.durationMs };
}

// ---------- Analista cuantitativo ----------

export const QuantMemoSchema = z
  .object({
    summary: text(400).describe("Conclusión principal en 1-2 frases"),
    ideas: z
      .array(
        z
          .object({
            symbol: z.string().trim().min(1).max(20),
            action: z.enum(["comprar", "aumentar", "mantener", "reducir", "vender", "vigilar"]),
            horizon: z.enum(["corto", "medio", "largo"]).describe("corto = días/semanas, medio = meses, largo = más de un año"),
            conviction: z.number().int().min(1).max(5),
            reason: text(400),
          })
          .strict(),
      )
      .max(8),
    portfolio_notes: text(1200).describe("Lectura cuantitativa de la cartera: riesgo, Monte Carlo, correlaciones"),
  })
  .strict();
export type QuantMemo = z.infer<typeof QuantMemoSchema>;

const QUANT_SYSTEM = `Eres el ANALISTA CUANTITATIVO de un fondo de inversión simulado (dinero ficticio) gestionado por un equipo de IAs. No decides las órdenes: preparas un memo para el gestor de cartera.
Reglas:
1. Usa SOLO las cifras del mensaje (informe calculado por código: riesgo, Monte Carlo, estrés, factores, post-mortem). Nada de memoria.
2. Propón como máximo 8 ideas concretas, con su horizonte (corto = días o semanas, medio = meses, largo = más de un año) y convicción del 1 al 5. Incluye ideas tácticas de corto plazo si los datos lo justifican, no solo de largo plazo.
3. Las ideas deben ser del ranking de factores o de la cartera actual. Busca diversificar por regiones (la cartera es global) y vigila las correlaciones.
4. Ten en cuenta los costes: comisión 0,10 % (mínimo 1 €) y slippage 0,05 % por operación.
5. Sé crítico con el post-mortem: si las operaciones pasadas lo hacen peor que el benchmark, dilo.
6. Escribe en español y responde solo con el JSON del esquema.`;

// ---------- Gestora de riesgos ----------

export const RiskMemoSchema = z
  .object({
    summary: text(400),
    risk_level: z.enum(["bajo", "moderado", "elevado", "alto"]),
    budget: text(600).describe("Cuánto riesgo nuevo se puede asumir hoy y dónde no conviene añadir"),
    limits: z.array(text(300)).max(6).describe("Límites o recomendaciones concretas para esta ejecución"),
    concerns: z
      .array(z.object({ symbol: z.string().trim().max(20).nullable(), issue: text(300) }).strict())
      .max(8),
  })
  .strict();
export type RiskMemo = z.infer<typeof RiskMemoSchema>;

function riskSystem(cfg: ExperimentConfig): string {
  return `Eres la GESTORA DE RIESGOS de un fondo de inversión simulado (dinero ficticio) gestionado por un equipo de IAs. No decides las órdenes: preparas un memo para el gestor de cartera con los riesgos y límites de hoy.
Reglas:
1. Usa SOLO las cifras del mensaje (VaR, CVaR, volatilidad, beta, Monte Carlo, estrés, contribución al riesgo, correlaciones, pesos). Nada de memoria.
2. Límites duros del sistema (el motor rechaza lo que los incumpla): máximo ${(cfg.maxPositionPct * 100).toFixed(0)} % por activo, solo contado, unidades enteras. Tú puedes recomendar límites más prudentes.
3. Señala concentraciones (por activo, región, sector, divisa), posiciones que aportan demasiado riesgo para su peso y pares muy correlacionados.
4. Si el manual de estrategia de la academia tiene reglas de riesgo, compruébalas. Decisión del propietario: NO hay límite al número de operaciones por día ni por semana: no recomiendes topes de número de operaciones.
5. No seas alarmista sin datos: un fondo necesita asumir riesgo para batir al benchmark.
6. Escribe en español y responde solo con el JSON del esquema.`;
}

export interface TeamInput {
  quantText: string;
  positionsText: string;
  playbook: string | null;
  model: string;
  config: ExperimentConfig;
}

/** Lanza a los dos analistas en paralelo. Nunca lanza excepción: devuelve null en el que falle. */
export async function runTeam(input: TeamInput, log: (m: string) => void) {
  const playbook = input.playbook ? `\n\n## MANUAL DE ESTRATEGIA VIGENTE (Academia)\n${input.playbook}` : "";
  const base = `## CARTERA ACTUAL\n${input.positionsText}\n\n## INFORME CUANTITATIVO (calculado por código)\n${input.quantText}${playbook}`;
  const [quant, risk] = await Promise.all([
    callAgent({ schema: QuantMemoSchema, system: QUANT_SYSTEM, prompt: `${base}\n\nEscribe tu memo para el gestor.`, model: input.model }).catch((e: Error) => {
      log(`Analista cuantitativo: fallo (${e.message}). El gestor decidirá sin su memo.`);
      return null;
    }),
    callAgent({ schema: RiskMemoSchema, system: riskSystem(input.config), prompt: `${base}\n\nEscribe tu memo de riesgos para el gestor.`, model: input.model }).catch((e: Error) => {
      log(`Gestora de riesgos: fallo (${e.message}). El gestor decidirá sin su memo.`);
      return null;
    }),
  ]);
  if (quant) log(`Analista cuantitativo (${(quant.durationMs / 1000).toFixed(1)} s): ${quant.value.summary}`);
  if (risk) log(`Gestora de riesgos (${(risk.durationMs / 1000).toFixed(1)} s): riesgo ${risk.value.risk_level}. ${risk.value.summary}`);
  return { quant, risk };
}

export function quantMemoText(m: QuantMemo): string {
  return [
    m.summary,
    ...m.ideas.map((i) => `- ${i.action.toUpperCase()} ${i.symbol} (horizonte ${i.horizon}, convicción ${i.conviction}/5): ${i.reason}`),
    `Notas: ${m.portfolio_notes}`,
  ].join("\n");
}

export function riskMemoText(m: RiskMemo): string {
  return [
    `Nivel de riesgo: ${m.risk_level}. ${m.summary}`,
    `Presupuesto de riesgo: ${m.budget}`,
    ...m.limits.map((l) => `- Límite: ${l}`),
    ...m.concerns.map((c) => `- Preocupación${c.symbol ? ` (${c.symbol})` : ""}: ${c.issue}`),
  ].join("\n");
}

export async function saveReport(db: Db, row: { experimentId: string; runId: string | null; agent: string; summary: string; content: unknown; model?: string | null; durationMs?: number | null; period?: string | null }): Promise<Row> {
  return insertChained(db, "agent_reports", {
    experiment_id: row.experimentId,
    run_id: row.runId,
    at: new Date(),
    agent: row.agent,
    period: row.period ?? null,
    summary: row.summary.slice(0, 1000),
    content: row.content,
    model: row.model ?? null,
    duration_ms: row.durationMs ?? null,
  });
}

export async function latestPlaybook(db: Db, experimentId: string): Promise<{ playbook: string; period: string } | null> {
  const { data } = await db.from("agent_reports").select("content,period").eq("experiment_id", experimentId).eq("agent", "academy").order("seq", { ascending: false }).limit(1);
  const r = data?.[0];
  return r ? { playbook: String((r.content as Row).playbook), period: String(r.period) } : null;
}
