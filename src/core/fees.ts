import { eur, px } from "./money";
import type { ExperimentConfig, Side } from "./types";

/** Comisión del bróker en EUR: porcentaje del importe con un mínimo fijo. */
export function commissionEur(grossEur: number, cfg: ExperimentConfig): number {
  return eur(Math.max(grossEur * cfg.commissionPct, cfg.commissionMin));
}

/** Comisión de cambio de divisa (0 si el activo cotiza en EUR). */
export function fxFeeEur(grossEur: number, currency: string, cfg: ExperimentConfig): number {
  return currency === "EUR" ? 0 : eur(grossEur * cfg.fxFeePct);
}

/** Precio con slippage en contra: compras más caras, ventas más baratas. */
export function slippedPrice(price: number, side: Side, cfg: ExperimentConfig): number {
  return px(side === "buy" ? price * (1 + cfg.slippagePct) : price * (1 - cfg.slippagePct));
}
