import { avgCostEur, avgPriceLocal } from "@/core/portfolio";
import { Empty, NoExperiment, Section } from "@/components/ui";
import { getContext, latestPrices, loadData } from "@/lib/data";
import { fmtDateTime, fmtEur, fmtNum, fmtPct, fmtPrice, tone } from "@/lib/format";

export default async function PosicionesPage() {
  const { exp } = await getContext();
  if (!exp) return <NoExperiment />;
  const d = await loadData(exp);
  const prices = latestPrices(d.latest);
  const total = d.latest ? Number(d.latest.total_eur) : Number(exp.initial_capital);
  const rows = [...d.portfolio.positions.values()].map((p) => {
    const lp = prices.get(p.symbol);
    const valueEur = lp ? (p.quantity * lp.price) / lp.fx : p.costEur;
    return { p, lp, valueEur, pnl: valueEur - p.costEur, pnlPct: valueEur / p.costEur - 1, weight: valueEur / total };
  });
  rows.sort((a, b) => b.valueEur - a.valueEur);
  const doneOrders = new Set([...d.fills.map((f) => f.order_id), ...d.orderEvents.map((e) => e.order_id)]);
  const pending = d.orders.filter((o) => o.status === "pending" && !doneOrders.has(o.id));
  const cash = d.latest ? Number(d.latest.cash_eur) : d.portfolio.cashEur;

  return (
    <div className="space-y-4">
      <Section title={`Posiciones (${rows.length})`} actions={d.latest && <span className="text-xs text-muted">Precios del {fmtDateTime(d.latest.at)}</span>}>
        {rows.length === 0 ? (
          <Empty>Claude no tiene posiciones abiertas: la cartera está en efectivo.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Activo</th>
                  <th className="r">Cantidad</th>
                  <th className="r">Precio medio</th>
                  <th className="r">Precio actual</th>
                  <th className="r">Valor</th>
                  <th className="r">P&L latente</th>
                  <th className="r">Peso</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, lp, valueEur, pnl, pnlPct, weight }) => (
                  <tr key={p.symbol}>
                    <td>
                      <div className="font-medium">{p.symbol}</div>
                      <div className="text-xs text-muted">{d.instruments.get(p.symbol)?.name ?? ""}</div>
                    </td>
                    <td className="r">{fmtNum(p.quantity)}</td>
                    <td className="r">
                      {fmtPrice(avgPriceLocal(p), p.currency)}
                      {p.currency !== "EUR" && <div className="text-xs text-muted">{fmtEur(avgCostEur(p))} con costes</div>}
                    </td>
                    <td className="r">{lp ? fmtPrice(lp.price, p.currency) : "—"}</td>
                    <td className="r">{fmtEur(valueEur)}</td>
                    <td className={`r ${tone(pnl)}`}>
                      {fmtEur(pnl)}
                      <div className="text-xs">{fmtPct(pnlPct)}</div>
                    </td>
                    <td className="r">{fmtPct(weight, false, 1)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="font-medium">Efectivo</td>
                  <td colSpan={3} />
                  <td className="r">{fmtEur(cash)}</td>
                  <td />
                  <td className="r">{fmtPct(cash / total, false, 1)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">
          El P&L latente incluye comisiones y el efecto del tipo de cambio (el coste se calcula en euros). P&L realizado acumulado: {fmtEur(d.portfolio.realizedPnlEur)} · dividendos cobrados: {fmtEur(d.portfolio.dividendsEur)}.
        </p>
      </Section>

      <Section title="Órdenes limitadas pendientes">
        {pending.length === 0 ? (
          <Empty>No hay órdenes pendientes.</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Activo</th>
                <th>Tipo</th>
                <th className="r">Cantidad</th>
                <th className="r">Límite</th>
                <th>Caduca</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((o) => (
                <tr key={o.id}>
                  <td>{o.symbol}</td>
                  <td>{o.side === "buy" ? "Compra" : "Venta"}</td>
                  <td className="r">{fmtNum(Number(o.quantity))}</td>
                  <td className="r">{fmtPrice(Number(o.limit_price), o.quote_currency ?? "EUR")}</td>
                  <td>{fmtDateTime(o.expires_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
