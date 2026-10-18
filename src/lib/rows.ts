// Conversión de filas de Supabase a eventos del registro (compartido por web y agente).
import type { LedgerEvent } from "@/core/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export function fillRowToEvent(f: Row): LedgerEvent {
  return {
    type: "fill",
    at: new Date(f.at),
    fill: {
      symbol: f.symbol,
      side: f.side,
      quantity: Number(f.quantity),
      priceLocal: Number(f.price_local),
      refPriceLocal: Number(f.ref_price_local),
      currency: f.currency,
      fxRate: Number(f.fx_rate),
      fxSource: f.fx_source,
      fxTime: f.fx_time ? new Date(f.fx_time) : null,
      grossEur: Number(f.gross_eur),
      commissionEur: Number(f.commission_eur),
      fxFeeEur: Number(f.fx_fee_eur),
      cashDeltaEur: Number(f.cash_delta_eur),
      executedAt: new Date(f.at),
      priceSource: f.price_source,
      priceTime: f.price_time ? new Date(f.price_time) : new Date(f.at),
    },
  };
}

export function corporateRowToEvent(c: Row): LedgerEvent {
  // Se aplica al inicio del día ex (antes de cualquier operación de ese día).
  const at = new Date(`${c.ex_date}T00:00:00Z`);
  return c.kind === "split"
    ? { type: "split", at, symbol: c.symbol, ratio: Number(c.ratio) }
    : { type: "dividend", at, symbol: c.symbol, cashEur: Number(c.cash_eur) };
}
