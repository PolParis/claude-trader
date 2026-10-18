// Capa de abstracción de datos de mercado: el resto del código solo conoce esta interfaz,
// así se puede cambiar Yahoo por otra fuente sin tocar el agente ni el motor.
import type { DailyClose } from "@/core/indicators";
import type { Bar } from "@/core/limits";
import type { MarketId, Quote } from "@/core/types";

export interface MarketQuote extends Quote {
  name: string;
  exchangeCode: string | null;
  market: MarketId | null; // null = bolsa no permitida
  quoteType: string | null; // EQUITY, ETF, INDEX, CURRENCY, CRYPTOCURRENCY, FUTURE
  changePct: number | null; // variación del día en %
  high52w: number | null;
  low52w: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  marketCap: number | null;
  dividendYield: number | null; // %
  previousClose: number | null;
}

export interface CorporateEvent {
  kind: "dividend" | "split";
  date: Date; // fecha ex
  amount?: number; // dividendo por acción (divisa local)
  ratio?: number; // split: acciones nuevas por cada antigua
}

export interface NewsItem {
  title: string;
  publisher: string | null;
  publishedAt: Date | null;
  tickers: string[];
}

export interface MarketDataProvider {
  readonly name: string;
  getQuotes(symbols: string[]): Promise<Map<string, MarketQuote>>;
  getDailyHistory(symbol: string, from: Date): Promise<DailyClose[]>;
  getIntradayBars(symbol: string, from: Date, to: Date): Promise<Bar[]>;
  getEvents(symbol: string, from: Date): Promise<CorporateEvent[]>;
  getNews(query: string, count: number): Promise<NewsItem[]>;
}
