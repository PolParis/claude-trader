// Tipos compartidos por el motor, el agente y la web.

export type Currency = "EUR" | "USD";
export type Side = "buy" | "sell";
export type OrderType = "market" | "limit";
export type MarketId = "US" | "XETRA" | "EURONEXT" | "BME" | "CRYPTO";
export type InstrumentKind = "stock" | "etf" | "crypto";

export interface ExperimentConfig {
  initialCapital: number;
  commissionPct: number; // 0.001 = 0,10 %
  commissionMin: number; // en EUR
  slippagePct: number; // 0.0005 = 0,05 %
  fxFeePct: number; // comisión de cambio sobre el importe en EUR
  maxPositionPct: number; // 0.25 = 25 %
  allowCrypto: boolean;
  allowFractional: boolean;
  riskFreeRate: number; // anual, para Sharpe
  maxQuoteAgeMinutes: number; // precio más antiguo aceptado para ejecutar
}

export const DEFAULT_CONFIG: ExperimentConfig = {
  initialCapital: 10_000,
  commissionPct: 0.001,
  commissionMin: 1,
  slippagePct: 0.0005,
  fxFeePct: 0,
  maxPositionPct: 0.25,
  allowCrypto: false,
  allowFractional: false,
  riskFreeRate: 0,
  maxQuoteAgeMinutes: 30,
};

export interface Instrument {
  symbol: string;
  name: string;
  market: MarketId;
  currency: Currency;
  kind: InstrumentKind;
  region: string;
}

export interface Quote {
  symbol: string;
  price: number;
  currency: string;
  source: string;
  quoteTime: Date; // hora de la última cotización según la fuente
  fetchedAt: Date; // cuándo la pedimos
  declaredDelayMin: number | null; // retraso que declara la fuente
  marketState: string | null; // REGULAR, CLOSED, PRE, POST...
}

/** Tipo de cambio EUR→divisa: unidades de divisa por 1 EUR (EURUSD=X ≈ 1,12). */
export interface FxRate {
  currency: Currency;
  rate: number;
  source: string;
  time: Date;
}

export interface OrderRequest {
  symbol: string;
  side: Side;
  quantity: number;
  type: OrderType;
  limitPrice?: number | null;
  rationale?: string;
}

export interface Fill {
  symbol: string;
  side: Side;
  quantity: number;
  priceLocal: number; // precio de ejecución (con slippage) en la divisa del activo
  refPriceLocal: number; // precio de referencia (cotización o límite)
  currency: Currency;
  fxRate: number; // divisa por EUR (1 si EUR)
  fxSource: string | null;
  fxTime: Date | null;
  grossEur: number;
  commissionEur: number;
  fxFeeEur: number;
  cashDeltaEur: number; // negativo en compras, positivo en ventas
  executedAt: Date;
  priceSource: string;
  priceTime: Date;
}

export type LedgerEvent =
  | { type: "fill"; at: Date; fill: Fill }
  | { type: "dividend"; at: Date; symbol: string; cashEur: number }
  | { type: "split"; at: Date; symbol: string; ratio: number };
