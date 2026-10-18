// Une órdenes, ejecuciones y eventos en filas para la tabla de operaciones y el CSV.
import type { Row } from "./data";

export interface TradeRow {
  order: Row;
  fill: Row | null;
  event: Row | null;
  status: string;
  slippageEur: number | null;
}

export function buildTradeRows(orders: Row[], fills: Row[], events: Row[]): TradeRow[] {
  const fillBy = new Map(fills.map((f) => [f.order_id, f]));
  const eventBy = new Map(events.map((e) => [e.order_id, e]));
  return orders
    .map((o) => {
      const fill = fillBy.get(o.id) ?? null;
      const event = eventBy.get(o.id) ?? null;
      const status = fill ? "filled" : event ? event.event : o.status;
      const slippageEur = fill
        ? (Math.abs(Number(fill.price_local) - Number(fill.ref_price_local)) * Number(fill.quantity)) / Number(fill.fx_rate)
        : null;
      return { order: o, fill, event, status, slippageEur };
    })
    .sort((a, b) => Number(b.order.seq) - Number(a.order.seq));
}

const REJECT_LABEL: Record<string, string> = {
  NOT_IN_UNIVERSE: "Fuera del universo",
  CRYPTO_DISABLED: "Cripto desactivada",
  CURRENCY_NOT_ALLOWED: "Divisa no permitida",
  INVALID_QUANTITY: "Cantidad inválida",
  INVALID_LIMIT: "Límite inválido",
  MARKET_CLOSED: "Mercado cerrado",
  NO_QUOTE: "Sin precio",
  STALE_QUOTE: "Precio antiguo",
  NO_FX: "Sin tipo de cambio",
  INSUFFICIENT_CASH: "Sin efectivo",
  INSUFFICIENT_SHARES: "Sin acciones",
  MAX_POSITION: "Límite 25 %",
};
export const rejectLabel = (code: string | null) => (code ? (REJECT_LABEL[code] ?? code) : "");
