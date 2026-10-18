// Proveedor Yahoo Finance (yahoo-finance2): gratuito, sin clave, no oficial.
// Retraso: el que declara Yahoo (exchangeDataDelayedBy) y el medido (fetchedAt − regularMarketTime)
// se guardan con cada precio.
import fs from "node:fs";
import path from "node:path";
import YahooFinance from "yahoo-finance2";
import { madridDate } from "@/core/calendar";
import type { DailyClose } from "@/core/indicators";
import type { Bar } from "@/core/limits";
import { marketFromYahooExchange } from "@/core/markets";
import type { CorporateEvent, MarketDataProvider, MarketQuote, NewsItem } from "./provider";

const SOURCE = "Yahoo Finance";
const NO_VALIDATE = { validateResult: false } as const;
const CACHE_DIR = path.resolve(process.cwd(), "agent", ".cache", "history");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const toDate = (v: unknown): Date | null => {
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v);
  if (typeof v === "string") return new Date(v);
  return null;
};

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw new Error(`${label}: ${last instanceof Error ? last.message : String(last)}`);
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export class YahooProvider implements MarketDataProvider {
  readonly name = SOURCE;
  private yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

  async getQuotes(symbols: string[]): Promise<Map<string, MarketQuote>> {
    const out = new Map<string, MarketQuote>();
    const unique = [...new Set(symbols)];
    for (let i = 0; i < unique.length; i += 50) {
      const batch = unique.slice(i, i + 50);
      const fetchedAt = new Date();
      const raw: Raw[] = await withRetry("Yahoo quote", () => this.yf.quote(batch, {}, NO_VALIDATE) as Promise<Raw[]>);
      for (const q of Array.isArray(raw) ? raw : [raw]) {
        const price = num(q?.regularMarketPrice);
        const time = toDate(q?.regularMarketTime);
        if (!q?.symbol || price === null || !time) continue;
        const dy = num(q.dividendYield) ?? (num(q.trailingAnnualDividendYield) !== null ? q.trailingAnnualDividendYield * 100 : null);
        out.set(q.symbol, {
          symbol: q.symbol,
          price,
          currency: q.currency ?? "",
          source: SOURCE,
          quoteTime: time,
          fetchedAt,
          declaredDelayMin: num(q.exchangeDataDelayedBy),
          marketState: q.marketState ?? null,
          name: q.longName ?? q.shortName ?? q.symbol,
          exchangeCode: q.exchange ?? null,
          market: marketFromYahooExchange(q.exchange),
          quoteType: q.quoteType ?? null,
          changePct: num(q.regularMarketChangePercent),
          high52w: num(q.fiftyTwoWeekHigh),
          low52w: num(q.fiftyTwoWeekLow),
          trailingPE: num(q.trailingPE),
          forwardPE: num(q.forwardPE),
          marketCap: num(q.marketCap),
          dividendYield: dy,
          previousClose: num(q.regularMarketPreviousClose),
        });
      }
    }
    return out;
  }

  private async chart(symbol: string, opts: Record<string, unknown>): Promise<Raw> {
    return withRetry(`Yahoo chart ${symbol}`, () => this.yf.chart(symbol, opts as never, NO_VALIDATE) as Promise<Raw>);
  }

  /** Cierres diarios ajustados por splits. Se cachean en disco un día (por ticker). */
  async getDailyHistory(symbol: string, from: Date): Promise<DailyClose[]> {
    const day = madridDate(new Date());
    const file = path.join(CACHE_DIR, `${symbol.replace(/[^A-Za-z0-9.-]/g, "_")}_${day}_${madridDate(from)}.json`);
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as DailyClose[];
    } catch {
      // sin caché
    }
    const raw = await this.chart(symbol, { period1: from, interval: "1d" });
    const today = madridDate(new Date());
    const rows: DailyClose[] = (raw?.quotes ?? [])
      .map((q: Raw) => ({ date: madridDate(toDate(q.date)!), close: num(q.close) }))
      .filter((q: { close: number | null; date: string }) => q.close !== null && q.date < today) as DailyClose[];
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(rows));
    return rows;
  }

  async getIntradayBars(symbol: string, from: Date, to: Date): Promise<Bar[]> {
    const raw = await this.chart(symbol, { period1: from, period2: to, interval: "5m" });
    return (raw?.quotes ?? [])
      .filter((q: Raw) => num(q.low) !== null && num(q.high) !== null)
      .map((q: Raw) => ({ start: toDate(q.date)!, low: q.low, high: q.high }));
  }

  async getEvents(symbol: string, from: Date): Promise<CorporateEvent[]> {
    const raw = await this.chart(symbol, { period1: from, interval: "1d", events: "div|split" });
    const ev = raw?.events ?? {};
    const list = (x: Raw) => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : []);
    const out: CorporateEvent[] = [];
    for (const d of list(ev.dividends)) {
      const date = toDate(d.date);
      if (date && num(d.amount)) out.push({ kind: "dividend", date, amount: d.amount });
    }
    for (const s of list(ev.splits)) {
      const date = toDate(s.date);
      const ratio = num(s.numerator) && num(s.denominator) ? s.numerator / s.denominator : null;
      if (date && ratio && ratio !== 1) out.push({ kind: "split", date, ratio });
    }
    return out.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  async getNews(query: string, count: number): Promise<NewsItem[]> {
    try {
      const raw: Raw = await withRetry("Yahoo news", () => this.yf.search(query, { newsCount: count, quotesCount: 0 }, NO_VALIDATE) as Promise<Raw>, 2);
      return (raw?.news ?? []).slice(0, count).map((n: Raw) => ({
        title: String(n.title ?? ""),
        publisher: n.publisher ?? null,
        publishedAt: toDate(n.providerPublishTime),
        tickers: Array.isArray(n.relatedTickers) ? n.relatedTickers : [],
      }));
    } catch {
      return [];
    }
  }
}

export function defaultProvider(): MarketDataProvider {
  return new YahooProvider();
}
