import { Empty, NoExperiment, Section, StatusBadge } from "@/components/ui";
import { getContext, loadData } from "@/lib/data";
import { fmtDateTime, fmtEur, fmtNum, fmtPrice } from "@/lib/format";
import { buildTradeRows, rejectLabel } from "@/lib/trades";

export default async function OperacionesPage() {
  const { exp } = await getContext();
  if (!exp) return <NoExperiment />;
  const d = await loadData(exp);
  const rows = buildTradeRows(d.orders, d.fills, d.orderEvents);
  const filled = rows.filter((r) => r.fill);
  const commissions = filled.reduce((s, r) => s + Number(r.fill!.commission_eur), 0);
  const slippage = filled.reduce((s, r) => s + (r.slippageEur ?? 0), 0);

  return (
    <div className="space-y-4">
      <Section
        title={`Historial de órdenes (${rows.length})`}
        actions={
          <div className="flex gap-2 text-xs">
            <a download href="/api/export/operaciones" className="rounded-md border border-line px-2 py-1 hover:bg-surface-2">Descargar CSV de operaciones</a>
            <a download href="/api/export/snapshots" className="rounded-md border border-line px-2 py-1 hover:bg-surface-2">Descargar CSV de valoraciones</a>
          </div>
        }
      >
        <p className="mb-3 text-xs text-muted">
          {filled.length} ejecutadas · comisiones pagadas {fmtEur(commissions)} · coste estimado del slippage {fmtEur(slippage)}. Se muestran también las órdenes
          rechazadas por el motor, con el motivo.
        </p>
        {rows.length === 0 ? (
          <Empty>Todavía no hay órdenes.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Activo</th>
                  <th>Orden</th>
                  <th>Estado</th>
                  <th className="r">Precio ejec.</th>
                  <th className="r">Importe</th>
                  <th className="r">Comisión</th>
                  <th className="r">Slippage</th>
                  <th>Fuente del precio</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ order: o, fill: f, event, status, slippageEur }) => (
                  <tr key={o.id}>
                    <td className="whitespace-nowrap">{fmtDateTime(f?.at ?? o.at)}</td>
                    <td className="font-medium">{o.symbol}</td>
                    <td className="whitespace-nowrap">
                      {o.side === "buy" ? "Compra" : "Venta"} {fmtNum(Number(o.quantity))}
                      <div className="text-xs text-muted">
                        {o.order_type === "limit" ? `Limitada ${fmtPrice(Number(o.limit_price), o.quote_currency ?? "EUR")}` : "A mercado"}
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={status} />
                      {status === "rejected" && <div className="text-xs text-muted" title={o.reject_reason ?? ""}>{rejectLabel(o.reject_code)}: {o.reject_reason}</div>}
                      {event?.reason && <div className="text-xs text-muted">{event.reason}</div>}
                    </td>
                    <td className="r">
                      {f ? fmtPrice(Number(f.price_local), f.currency) : "—"}
                      {f && f.currency !== "EUR" && <div className="text-xs text-muted">EUR/USD {Number(f.fx_rate).toFixed(4)}</div>}
                    </td>
                    <td className="r">{f ? fmtEur(Number(f.gross_eur)) : "—"}</td>
                    <td className="r">{f ? fmtEur(Number(f.commission_eur) + Number(f.fx_fee_eur)) : "—"}</td>
                    <td className="r">{slippageEur !== null ? fmtEur(slippageEur) : "—"}</td>
                    <td className="text-xs text-muted">
                      {f ? (
                        <>
                          {f.price_source}
                          <div>cotización {fmtDateTime(f.price_time)}</div>
                        </>
                      ) : o.quote_source ? (
                        <>
                          {o.quote_source} · {fmtPrice(Number(o.quote_price), o.quote_currency ?? "EUR")}
                        </>
                      ) : (
                        "—"
                      )}
                      {o.quote_delay_s !== null && o.quote_delay_s !== undefined && <div>antigüedad {Math.round(Number(o.quote_delay_s) / 60)} min</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
