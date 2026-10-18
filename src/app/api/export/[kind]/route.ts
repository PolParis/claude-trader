// Exportación CSV (separador ";" y BOM para que Excel en español lo abra bien).
import { getContext, loadData } from "@/lib/data";
import { buildTradeRows } from "@/lib/trades";

function csv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
}

export async function GET(_req: Request, ctx: RouteContext<"/api/export/[kind]">) {
  const { kind } = await ctx.params;
  const { exp } = await getContext();
  if (!exp) return new Response("Sin experimento", { status: 404 });
  const d = await loadData(exp);
  let body: string;
  if (kind === "operaciones") {
    const rows = buildTradeRows(d.orders, d.fills, d.orderEvents).reverse();
    body = csv(
      ["orden_id", "fecha_orden", "fecha_ejecucion", "simbolo", "lado", "cantidad", "tipo", "precio_limite", "estado", "motivo_rechazo", "precio_ejecucion", "precio_referencia", "divisa", "tipo_cambio_eurusd", "fuente_tipo_cambio", "importe_eur", "comision_eur", "comision_cambio_eur", "slippage_eur", "flujo_caja_eur", "fuente_precio", "hora_cotizacion", "antiguedad_cotizacion_s", "retraso_declarado_min", "razon_claude", "hash"],
      rows.map(({ order: o, fill: f, status, slippageEur }) => [
        o.id, o.at, f?.at, o.symbol, o.side, o.quantity, o.order_type, o.limit_price, status, o.reject_reason,
        f?.price_local, f?.ref_price_local, f?.currency ?? o.quote_currency, f?.fx_rate, f?.fx_source, f?.gross_eur, f?.commission_eur, f?.fx_fee_eur,
        slippageEur?.toFixed(4), f?.cash_delta_eur, f?.price_source ?? o.quote_source, f?.price_time ?? o.quote_time, o.quote_delay_s, o.declared_delay_min, o.rationale, f?.hash ?? o.hash,
      ]),
    );
  } else if (kind === "snapshots") {
    body = csv(
      ["fecha", "tipo", "dia", "efectivo_eur", "posiciones_eur", "total_eur", "msci_world_eur", "sp500_eur", "eurostoxx50_eur", "efectivo_benchmark_eur", "hash"],
      d.snapshots.map((s) => [s.at, s.kind, s.snapshot_date, s.cash_eur, s.positions_value_eur, s.total_eur, s.benchmarks?.MSCI_WORLD, s.benchmarks?.SP500, s.benchmarks?.EUROSTOXX50, s.benchmarks?.CASH, s.hash]),
    );
  } else return new Response("No encontrado", { status: 404 });
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exp.code}-${kind}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
