// La cartera no se guarda: se reconstruye siempre a partir del registro append-only
// (ejecuciones, dividendos y splits). Así no hay estado que se pueda "retocar".
import { eur } from "./money";
import type { Currency, LedgerEvent } from "./types";

export interface Position {
  symbol: string;
  currency: Currency;
  quantity: number;
  costEur: number; // coste total en EUR incluyendo comisiones
  costLocal: number; // coste en divisa local (sin comisiones) para el precio medio local
}

export interface ClosedTrade {
  symbol: string;
  at: Date;
  quantity: number;
  proceedsEur: number;
  costEur: number;
  pnlEur: number;
}

export interface PortfolioState {
  cashEur: number;
  positions: Map<string, Position>;
  realizedPnlEur: number;
  dividendsEur: number;
  commissionsEur: number;
  fxFeesEur: number;
  turnoverEur: number; // suma de importes comprados y vendidos
  closedTrades: ClosedTrade[];
}

export function avgCostEur(p: Position): number {
  return p.quantity > 0 ? p.costEur / p.quantity : 0;
}
export function avgPriceLocal(p: Position): number {
  return p.quantity > 0 ? p.costLocal / p.quantity : 0;
}

const QTY_EPS = 1e-9;

export function derivePortfolio(initialCapital: number, events: LedgerEvent[]): PortfolioState {
  const state: PortfolioState = {
    cashEur: initialCapital,
    positions: new Map(),
    realizedPnlEur: 0,
    dividendsEur: 0,
    commissionsEur: 0,
    fxFeesEur: 0,
    turnoverEur: 0,
    closedTrades: [],
  };
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const ev of sorted) applyEvent(state, ev);
  state.cashEur = eur(state.cashEur);
  return state;
}

export function applyEvent(state: PortfolioState, ev: LedgerEvent): void {
  if (ev.type === "dividend") {
    state.cashEur += ev.cashEur;
    state.dividendsEur += ev.cashEur;
    return;
  }
  if (ev.type === "split") {
    const p = state.positions.get(ev.symbol);
    if (p) p.quantity = p.quantity * ev.ratio;
    return;
  }
  const f = ev.fill;
  state.cashEur += f.cashDeltaEur;
  state.commissionsEur += f.commissionEur;
  state.fxFeesEur += f.fxFeeEur;
  state.turnoverEur += f.grossEur;
  let p = state.positions.get(f.symbol);
  if (f.side === "buy") {
    if (!p) {
      p = { symbol: f.symbol, currency: f.currency, quantity: 0, costEur: 0, costLocal: 0 };
      state.positions.set(f.symbol, p);
    }
    p.quantity += f.quantity;
    p.costEur += -f.cashDeltaEur;
    p.costLocal += f.quantity * f.priceLocal;
    return;
  }
  if (!p || p.quantity + QTY_EPS < f.quantity) {
    throw new Error(`Venta de ${f.quantity} ${f.symbol} sin posición suficiente`);
  }
  const share = f.quantity / p.quantity;
  const costOut = p.costEur * share;
  const pnl = f.cashDeltaEur - costOut;
  p.costEur -= costOut;
  p.costLocal -= p.costLocal * share;
  p.quantity -= f.quantity;
  state.realizedPnlEur += pnl;
  state.closedTrades.push({
    symbol: f.symbol,
    at: f.executedAt,
    quantity: f.quantity,
    proceedsEur: f.cashDeltaEur,
    costEur: costOut,
    pnlEur: pnl,
  });
  if (p.quantity <= QTY_EPS) state.positions.delete(f.symbol);
}

/** Cantidad que se tenía de un activo justo antes de `at` (para dividendos). */
export function quantityHeldBefore(events: LedgerEvent[], symbol: string, at: Date): number {
  let qty = 0;
  for (const ev of [...events].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (ev.at >= at) break;
    if (ev.type === "fill" && ev.fill.symbol === symbol) qty += ev.fill.side === "buy" ? ev.fill.quantity : -ev.fill.quantity;
    if (ev.type === "split" && ev.symbol === symbol) qty *= ev.ratio;
  }
  return qty;
}

export interface Valuation {
  cashEur: number;
  positionsValueEur: number;
  totalEur: number;
  holdings: {
    symbol: string;
    quantity: number;
    priceLocal: number;
    currency: Currency;
    fxRate: number;
    valueEur: number;
    costEur: number;
  }[];
}

/**
 * Valora la cartera con los precios dados. `prices` en divisa local; `fx` = divisa por EUR.
 * Si falta un precio se usa el coste medio (y se marca para que la UI lo avise).
 */
export function valuePortfolio(
  state: Pick<PortfolioState, "cashEur" | "positions">,
  prices: Map<string, number>,
  fx: Partial<Record<Currency, number>>,
): Valuation & { missingPrices: string[] } {
  const holdings: Valuation["holdings"] = [];
  const missingPrices: string[] = [];
  let positionsValue = 0;
  for (const p of state.positions.values()) {
    const rate = p.currency === "EUR" ? 1 : fx[p.currency];
    const price = prices.get(p.symbol);
    let valueEur: number;
    let priceLocal: number;
    if (price === undefined || !rate) {
      missingPrices.push(p.symbol);
      valueEur = p.costEur;
      priceLocal = avgPriceLocal(p);
    } else {
      priceLocal = price;
      valueEur = (p.quantity * price) / rate;
    }
    positionsValue += valueEur;
    holdings.push({
      symbol: p.symbol,
      quantity: p.quantity,
      priceLocal,
      currency: p.currency,
      fxRate: rate ?? 0,
      valueEur: eur(valueEur),
      costEur: eur(p.costEur),
    });
  }
  holdings.sort((a, b) => b.valueEur - a.valueEur);
  return {
    cashEur: eur(state.cashEur),
    positionsValueEur: eur(positionsValue),
    totalEur: eur(state.cashEur + positionsValue),
    holdings,
    missingPrices,
  };
}
