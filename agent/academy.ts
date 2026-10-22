// Academia semanal: `npm run academy` (la lanza la tarea de cierre los viernes).
// Opciones: --dry-run (no guarda), --day YYYY-MM-DD (semana a revisar; por defecto, hoy en Madrid).
import { madridDate } from "@/core/calendar";
import { runAcademy } from "./lib/agent/academy";
import { adminClient, getExperiment } from "./lib/db";

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

const db = adminClient();
const exp = await getExperiment(db, opt("experiment") ?? process.env.EXPERIMENT_CODE ?? "test-1");
if (!exp.startedAt) {
  log(`El experimento ${exp.code} no ha empezado.`);
} else {
  try {
    const r = await runAcademy({ db, exp, day: opt("day") ?? madridDate(new Date()), log, dryRun: argv.includes("--dry-run") });
    if (r && argv.includes("--dry-run")) console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    log(`Academia: ERROR ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
