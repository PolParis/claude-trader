// Órdenes limitadas pendientes: válidas durante la sesión del día en que se dieron.
// Se revisan con barras de 5 minutos: si algún tramo posterior a la orden tocó el límite,
// se ejecuta al precio límite (sin slippage, el límite es el peor precio posible).
import { buildFill, type PendingOrder } from "./engine";
import type { Currency, ExperimentConfig, Fill, FxRate } from "./types";

export interface Bar {
  start: Date;
  low: number;
  high: number;
}

export const BAR_MINUTES = 5;

export type PendingOutcome =
  | { status: "filled"; fill: Fill; barStart: Date }
  | { status: "expired" }
  | { status: "pending" };

export function resolvePendingOrder(args: {
  order: PendingOrder;
  bars: Bar[];
  now: Date;
  currency: Currency;
  fx: FxRate | null;
  config: ExperimentConfig;
  source: string;
}): PendingOutcome {
  const { order } = args;
  const eligible = args.bars
    .filter((b) => b.start >= order.placedAt && b.start < order.expiresAt && b.start.getTime() + BAR_MINUTES * 60_000 <= args.now.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const hit = eligible.find((b) => (order.side === "buy" ? b.low <= order.limitPrice : b.high >= order.limitPrice));
  if (hit) {
    const at = new Date(Math.min(hit.start.getTime() + BAR_MINUTES * 60_000, order.expiresAt.getTime()));
    const fill = buildFill({
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      priceLocal: order.limitPrice,
      refPriceLocal: order.limitPrice,
      currency: args.currency,
      fx: args.fx,
      config: args.config,
      at,
      priceSource: `${args.source} (barra 5 min)`,
      priceTime: hit.start,
    });
    return { status: "filled", fill, barStart: hit.start };
  }
  if (args.now >= order.expiresAt) return { status: "expired" };
  return { status: "pending" };
}
