// Redondeos y conversión de divisas. Los importes en EUR se guardan con 2 decimales,
// los precios con hasta 6.

export function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON * Math.sign(value)) * f) / f;
}

export const eur = (v: number) => round(v, 2);
export const px = (v: number) => round(v, 6);

/** Convierte un importe en divisa local a EUR. `rate` = unidades de divisa por 1 EUR. */
export function toEur(amountLocal: number, rate: number): number {
  if (!(rate > 0)) throw new Error(`Tipo de cambio inválido: ${rate}`);
  return amountLocal / rate;
}
