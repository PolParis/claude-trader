// Lectura de los informes del equipo de agentes (tabla agent_reports) para la web.
import "server-only";
import { getContext, type Row } from "./data";

export const AGENTS = ["quant_engine", "quant_analyst", "risk_manager", "academy"] as const;
export type AgentCode = (typeof AGENTS)[number];

/** Último informe de un agente (opcionalmente de una ejecución concreta). */
export async function latestReport(experimentId: string, agent: AgentCode, runId?: string): Promise<Row | null> {
  const { supabase } = await getContext();
  let q = supabase.from("agent_reports").select("*").eq("experiment_id", experimentId).eq("agent", agent);
  if (runId) q = q.eq("run_id", runId);
  const { data } = await q.order("seq", { ascending: false }).limit(1);
  return (data?.[0] as Row) ?? null;
}

/** Informes de la academia, del más reciente al más antiguo. */
export async function academyReports(experimentId: string): Promise<Row[]> {
  const { supabase } = await getContext();
  const { data } = await supabase.from("agent_reports").select("*").eq("experiment_id", experimentId).eq("agent", "academy").order("seq", { ascending: false });
  return (data ?? []) as Row[];
}
