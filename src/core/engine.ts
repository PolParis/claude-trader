// Motor de ejecución determinista. Recibe las órdenes de Claude y decide, con reglas fijas,
// si se ejecutan, se rechazan o quedan pendientes (órdenes limitadas). No escribe en la BD:
// devuelve resultados que el agente persiste.
import { isMarketOpen, sessionFor } from "./calendar";
import { commissionEur, fxFeeEur, slippedPrice } from "./fees";
import { eur, px } from "./money";
import { applyEvent, valuePortfolio, type PortfolioState } from "./portfolio";
import type { Currency, ExperimentConfig, Fill, FxRate, Instrument, OrderRequest, Quote, Side } from "./types";

export type RejectCode =
  | "NOT_IN_UNIVERSE"
  | "CRYPTO_DISABLED"
  | "CURRENCY_NOT_ALLOWED"
  | "INVALID_QUANTITY"
  | "INVALID_LIMIT"
  | "MARKET_CLOSED"
  | "NO_QUOTE"
  | "STALE_QUOTE"
  | "NO_FX"
  | "INSUFFICIENT_CASH"
  | "INSUFFICIENT_SHARES"
  | "MAX_POSITION";

export interface PendingOrder {
  orderId?: number;
  symbol: string;
  side: Side;
  quantity: number;
  limitPrice: number;
  reservedCashEur: number; // solo compras
  placedAt: Date;
  expiresAt: Date;
}

export interface OrderResult {
  index: number; // posición en la lista original de Claude
  request: OrderRequest;
  status: "filled" | "rejected" | "pending";
  rejectCode?: RejectCode;
  rejectReason?: string;
  fill?: Fill;
  quote?: Quote;
  pending?: PendingOrder;
}

export interface EngineInput {
  config: ExperimentConfig;
  now: Date;
  portfolio: PortfolioState;
  pending: PendingOrder[];
  instruments: Map<string, Instrument>; // solo los activos incluidos en el prompt
  quotes: Map<string, Quote>;
  fx: Partial<Record<Currency, FxRate>>;
  orders: OrderRequest[];
}

export interface EngineOutput {
  results: OrderResult[];
  portfolio: PortfolioState;
  pending: PendingOrder[];
}

export function clonePortfolio(p: PortfolioState): PortfolioState {
  return {
    ...p,
    positions: new Map([...p.positions].map(([k, v]) => [k, { ...v }])),
    closedTrades: [...p.closedTrades],
  };
}

export function buildFill(args: {
  symbol: string;
  side: Side;
  quantity: number;
  priceLocal: number;
  refPriceLocal: number;
  currency: Currency;
  fx: FxRate | null;
  config: ExperimentConfig;
  at: Date;
  priceSource: string;
  priceTime: Date;
}): Fill {
  const rate = args.currency === "EUR" ? 1 : args.fx?.rate;
  if (!rate) throw new Error(`Falta tipo de cambio para ${args.currency}`);
  const grossEur = eur((args.quantity * args.priceLocal) / rate);
  const commission = commissionEur(grossEur, args.config);
  const fxFee = fxFeeEur(grossEur, args.currency, args.config);
  const cashDeltaEur = args.side === "buy" ? -eur(grossEur + commission + fxFee) : eur(grossEur - commission - fxFee);
  return {
    symbol: args.symbol,
    side: args.side,
    quantity: args.quantity,
    priceLocal: px(args.priceLocal),
    refPriceLocal: px(args.refPriceLocal),
    currency: args.currency,
    fxRate: rate,
    fxSource: args.currency === "EUR" ? null : (args.fx?.source ?? null),
    fxTime: args.currency === "EUR" ? null : (args.fx?.time ?? null),
    grossEur,
    commissionEur: commission,
    fxFeeEur: fxFee,
    cashDeltaEur,
    executedAt: args.at,
    priceSource: args.priceSource,
    priceTime: args.priceTime,
  };
}

/** Importe total en EUR que costaría comprar (incluyendo comisiones). */
function buyCostEur(qty: number, priceLocal: number, currency: Currency, rate: number, cfg: ExperimentConfig) {
  const gross = eur((qty * priceLocal) / rate);
  return { gross, total: eur(gross + commissionEur(gross, cfg) + fxFeeEur(gross, currency, cfg)) };
}

export function executeOrders(input: EngineInput): EngineOutput {
  const { config: cfg, now } = input;
  const portfolio = clonePortfolio(input.portfolio);
  const pending = [...input.pending];
  const results: OrderResult[] = [];

  const fxRates: Partial<Record<Currency, number>> = {};
  for (const [c, r] of Object.entries(input.fx)) if (r) fxRates[c as Currency] = r.rate;
  const prices = new Map([...input.quotes].map(([s, q]) => [s, q.price]));

  // Primero las ventas (liberan efectivo), después las compras; se respeta el orden de Claude dentro de cada grupo.
  const ordered = input.orders
    .map((request, index) => ({ request, index }))
    .sort((a, b) => (a.request.side === b.request.side ? a.index - b.index : a.request.side === "sell" ? -1 : 1));

  for (const { request, index } of ordered) {
    const reject = (code: RejectCode, reason: string, quote?: Quote): void => {
      results.push({ index, request, status: "rejected", rejectCode: code, rejectReason: reason, quote });
    };
    const symbol = request.symbol.trim().toUpperCase();
    const inst = input.instruments.get(symbol);
    if (!inst) {
      reject("NOT_IN_UNIVERSE", `${symbol} no estaba en los datos de esta ejecución`);
      continue;
    }
    if (inst.market === "CRYPTO" && !cfg.allowCrypto) {
      reject("CRYPTO_DISABLED", "Las criptomonedas están desactivadas");
      continue;
    }
    if (inst.currency !== "EUR" && inst.currency !== "USD") {
      reject("CURRENCY_NOT_ALLOWED", `Divisa ${inst.currency} no permitida`);
      continue;
    }
    const qty = request.quantity;
    if (!(qty > 0) || !Number.isFinite(qty) || (!cfg.allowFractional && !Number.isInteger(qty))) {
      reject("INVALID_QUANTITY", `Cantidad inválida: ${qty} (solo unidades enteras positivas)`);
      continue;
    }
    if (request.type === "limit" && !(request.limitPrice && request.limitPrice > 0)) {
      reject("INVALID_LIMIT", "Orden limitada sin precio límite válido");
      continue;
    }
    const quote = input.quotes.get(symbol);
    if (!quote) {
      reject("NO_QUOTE", `Sin cotización para ${symbol}`);
      continue;
    }
    const open = isMarketOpen(inst.market, now) && (quote.marketState === null || quote.marketState === "REGULAR");
    if (!open) {
      reject("MARKET_CLOSED", `Mercado ${inst.market} cerrado (estado: ${quote.marketState ?? "?"})`, quote);
      continue;
    }
    const ageMin = (now.getTime() - quote.quoteTime.getTime()) / 60_000;
    if (ageMin > cfg.maxQuoteAgeMinutes) {
      reject("STALE_QUOTE", `Precio de hace ${Math.round(ageMin)} min (máx. ${cfg.maxQuoteAgeMinutes})`, quote);
      continue;
    }
    const fx = inst.currency === "EUR" ? null : (input.fx[inst.currency] ?? null);
    const rate = inst.currency === "EUR" ? 1 : fx?.rate;
    if (!rate) {
      reject("NO_FX", `Sin tipo de cambio EUR/${inst.currency}`, quote);
      continue;
    }

    // ¿Ejecutable ahora? Market siempre; limit si el precio actual ya cumple el límite.
    let fillPrice = slippedPrice(quote.price, request.side, cfg);
    let executable = true;
    if (request.type === "limit") {
      const limit = request.limitPrice!;
      if (request.side === "buy") {
        executable = quote.price <= limit;
        fillPrice = Math.min(fillPrice, limit);
      } else {
        executable = quote.price >= limit;
        fillPrice = Math.max(fillPrice, limit);
      }
    }
    const checkPrice = executable ? fillPrice : request.limitPrice!;

    const reservedCash = pending.filter((p) => p.side === "buy").reduce((s, p) => s + p.reservedCashEur, 0);
    if (request.side === "sell") {
      const held = portfolio.positions.get(symbol)?.quantity ?? 0;
      const reservedQty = pending.filter((p) => p.side === "sell" && p.symbol === symbol).reduce((s, p) => s + p.quantity, 0);
      if (qty > held - reservedQty + 1e-9) {
        reject("INSUFFICIENT_SHARES", `Se intentan vender ${qty} ${symbol} y solo hay ${held - reservedQty} disponibles`, quote);
        continue;
      }
    } else {
      const cost = buyCostEur(qty, checkPrice, inst.currency, rate, cfg);
      const available = eur(portfolio.cashEur - reservedCash);
      if (cost.total > available + 1e-9) {
        reject("INSUFFICIENT_CASH", `Coste ${cost.total.toFixed(2)} € > efectivo disponible ${available.toFixed(2)} €`, quote);
        continue;
      }
      const valuation = valuePortfolio(portfolio, prices, fxRates);
      const pos = portfolio.positions.get(symbol);
      const current = pos ? (pos.quantity * quote.price) / rate : 0;
      const pendingSame = pending.filter((p) => p.side === "buy" && p.symbol === symbol).reduce((s, p) => s + p.reservedCashEur, 0);
      const after = current + pendingSame + cost.gross;
      const maxValue = valuation.totalEur * cfg.maxPositionPct;
      if (after > maxValue + 0.005) {
        reject(
          "MAX_POSITION",
          `${symbol} pesaría ${((after / valuation.totalEur) * 100).toFixed(1)} % (máx. ${(cfg.maxPositionPct * 100).toFixed(0)} %)`,
          quote,
        );
        continue;
      }
    }

    if (!executable) {
      const session = sessionFor(inst.market, now)!;
      const reserved = request.side === "buy" ? buyCostEur(qty, request.limitPrice!, inst.currency, rate, cfg).total : 0;
      const p: PendingOrder = {
        symbol,
        side: request.side,
        quantity: qty,
        limitPrice: request.limitPrice!,
        reservedCashEur: reserved,
        placedAt: now,
        expiresAt: session.close,
      };
      pending.push(p);
      results.push({ index, request, status: "pending", quote, pending: p });
      continue;
    }

    const fill = buildFill({
      symbol,
      side: request.side,
      quantity: qty,
      priceLocal: fillPrice,
      refPriceLocal: quote.price,
      currency: inst.currency,
      fx,
      config: cfg,
      at: now,
      priceSource: quote.source,
      priceTime: quote.quoteTime,
    });
    applyEvent(portfolio, { type: "fill", at: now, fill });
    results.push({ index, request, status: "filled", fill, quote });
  }

  return { results, portfolio, pending };
}
