// Comprobación de la capa de datos: `npm run market-check`.
// Muestra precio, estado del mercado y retraso (declarado y medido) de cada activo del universo.
import { isMarketOpen } from "@/core/calendar";
import { computeIndicators } from "@/core/indicators";
import { BASE_UNIVERSE } from "@/core/universe";
import { defaultProvider } from "./lib/market/yahoo";

async function main() {
  const provider = defaultProvider();
  const symbols = BASE_UNIVERSE.map((u) => u.symbol);
  const t0 = Date.now();
  const quotes = await provider.getQuotes([...symbols, "EURUSD=X"]);
  console.log(`Cotizaciones: ${quotes.size}/${symbols.length + 1} en ${Date.now() - t0} ms (${provider.name})\n`);
  const now = new Date();
  const rows = symbols.map((s) => {
    const q = quotes.get(s);
    if (!q) return { símbolo: s, error: "SIN DATOS" };
    return {
      símbolo: s,
      precio: q.price,
      divisa: q.currency,
      bolsa: q.exchangeCode,
      mercado: q.market ?? "NO PERMITIDO",
      estado: q.marketState,
      abierto: q.market ? isMarketOpen(q.market, now) : false,
      "retraso declarado (min)": q.declaredDelayMin,
      "antigüedad (min)": Math.round((now.getTime() - q.quoteTime.getTime()) / 60_000),
    };
  });
  console.table(rows);
  const missing = rows.filter((r) => "error" in r || r.mercado === "NO PERMITIDO" || (r.divisa !== "EUR" && r.divisa !== "USD"));
  if (missing.length) console.log("\n⚠ Revisar:", missing.map((r) => r.símbolo).join(", "));

  const hist = await provider.getDailyHistory("AAPL", new Date(Date.now() - 400 * 86_400_000));
  console.log(`\nHistórico AAPL: ${hist.length} sesiones. Indicadores:`, computeIndicators(hist, quotes.get("AAPL")!.price));
  const news = await provider.getNews("stock market", 3);
  console.log("\nNoticias:", news.map((n) => n.title));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
