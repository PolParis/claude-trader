// Genera las explicaciones para principiantes que falten: `npm run explain` (todas las ejecuciones
// con decisión y sin explicación) o `npm run explain -- --run <id>`. Solo añade filas nuevas.
import { BENCHMARKS } from "@/core/benchmarks";
import { explainRun } from "./lib/agent/explain";
import { adminClient, getExperiment } from "./lib/db";

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

const db = adminClient();
const exp = await getExperiment(db, opt("experiment") ?? process.env.EXPERIMENT_CODE ?? "test-1");
const benchmarkNames = Object.fromEntries(BENCHMARKS.map((b) => [b.code, b.name]));

let runIds: string[];
if (opt("run")) runIds = [opt("run")!];
else {
  const decided = (await db.from("journal_entries").select("run_id").eq("experiment_id", exp.id).in("kind", ["decision", "briefing"]).order("seq")).data ?? [];
  const done = new Set(((await db.from("explanations").select("run_id").eq("experiment_id", exp.id)).data ?? []).map((r) => r.run_id));
  runIds = decided.map((r) => r.run_id as string).filter((id) => id && !done.has(id));
}
log(`Experimento ${exp.code}: ${runIds.length} ejecuciones sin explicación.`);
for (const runId of runIds) {
  try {
    await explainRun({ db, exp, runId, benchmarkNames, log });
  } catch (e) {
    log(`ERROR en ${runId}: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
