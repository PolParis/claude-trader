// Reúne todos los datos de mercado de una ejecución: cotizaciones del universo, contexto,
// histórico + indicadores y titulares.
import { computeIndicators } from "@/core/indicators";
import { BASE_UNIVERSE, MARKET_CONTEXT } from "@/core/universe";
import type { UniverseRow } from "./agent/prompt";
import type { MarketDataProvider, MarketQuote, NewsItem } from "./market/provider";
import { mapLimit } from "./market/yahoo";
import { FX_SYMBOL } from "./ops";

export interface MarketSnapshot {
  quotes: Map<string, MarketQuote>;
  universe: UniverseRow[];
  context: { label: string; quote: MarketQuote | undefined }[];
  news: NewsItem[];
  regions: Map<string, string>;
  missing: string[];
}

export async function gatherMarketData(
  provider: MarketDataProvider,
  opts: { held: string[]; watchlist: Map<string, string>; pending: string[]; allowCrypto: boolean; log: (m: string) => void },
): Promise<MarketSnapshot> {
  const regions = new Map(BASE_UNIVERSE.map((u) => [u.symbol, u.region]));
  const symbols = [...new Set([...BASE_UNIVERSE.map((u) => u.symbol), ...opts.watchlist.keys(), ...opts.held, ...opts.pending])];
  const quotes = await provider.getQuotes([...symbols, ...MARKET_CONTEXT.map((c) => c.symbol), FX_SYMBOL]);
  const missing = symbols.filter((s) => !quotes.get(s));
  if (missing.length) opts.log(`Sin cotización: ${missing.join(", ")}`);

  const tradable = symbols
    .map((s) => quotes.get(s))
    .filter((q): q is MarketQuote => !!q && !!q.market && (q.currency === "EUR" || q.currency === "USD"))
    .filter((q) => opts.allowCrypto || q.market !== "CRYPTO");

  const from = new Date(Date.now() - 400 * 86_400_000);
  const indicators = await mapLimit(tradable, 6, async (q) => {
    try {
      return computeIndicators(await provider.getDailyHistory(q.symbol, from), q.price);
    } catch (e) {
      opts.log(`Sin histórico de ${q.symbol}: ${(e as Error).message}`);
      return null;
    }
  });

  const heldSet = new Set(opts.held);
  const universe: UniverseRow[] = tradable.map((q, i) => ({
    quote: q,
    region: regions.get(q.symbol) ?? (opts.watchlist.has(q.symbol) ? "Watchlist" : "Otros"),
    indicators: indicators[i],
    held: heldSet.has(q.symbol),
    watchlist: opts.watchlist.has(q.symbol),
  }));

  const newsQueries = ["stock market", "global economy", ...opts.held.slice(0, 6)];
  const newsLists = await mapLimit(newsQueries, 3, (q) => provider.getNews(q, q.includes(" ") ? 6 : 2));
  const seen = new Set<string>();
  const news = newsLists
    .flat()
    .filter((n) => n.title && !seen.has(n.title) && seen.add(n.title))
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
    .slice(0, 18);

  return {
    quotes,
    universe,
    context: MARKET_CONTEXT.map((c) => ({ label: c.label, quote: quotes.get(c.symbol) })),
    news,
    regions,
    missing,
  };
}
