// Inicia un experimento (fija la fecha de inicio, compra los benchmarks y lo marca como el
// que muestra la web). Para el oficial:
//   npm run start-experiment -- --code oficial --create --name "Experimento oficial"
// Solo funciona con Xetra y Euronext abiertos (L-V, 09:00–17:30 hora de Madrid).
import { adminClient, getExperiment } from "./lib/db";
import { defaultProvider } from "./lib/market/yahoo";
import { startExperiment } from "./lib/start";

const argv = process.argv.slice(2);
const opt = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

async function main() {
  const code = opt("code");
  if (!code) throw new Error("Indica --code <código>");
  const db = adminClient();
  if (argv.includes("--create")) {
    const res = await db.from("experiments").insert({ code, name: opt("name") ?? code, mode: argv.includes("--test") ? "test" : "official" });
    if (res.error) throw new Error(`No se pudo crear: ${res.error.message}`);
    console.log(`Experimento ${code} creado.`);
  }
  const exp = await getExperiment(db, code);
  await startExperiment(db, exp, defaultProvider(), new Date(), console.log);
  if (exp.mode === "official") {
    await db.from("experiments").update({ is_default: false }).neq("id", exp.id);
    await db.from("experiments").update({ is_default: true }).eq("id", exp.id);
    console.log("La web mostrará este experimento por defecto. Recuerda poner EXPERIMENT_CODE=" + code + " en .env.local");
  }
}

main().catch((e) => {
  console.error(`ERROR: ${(e as Error).message}`);
  process.exit(1);
});
