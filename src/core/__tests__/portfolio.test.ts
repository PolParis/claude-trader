import { describe, expect, it } from "vitest";
import { benchmarkValueEur, initBenchmark } from "../benchmarks";
import { buildFill, type PendingOrder } from "../engine";
import { resolvePendingOrder } from "../limits";
import { annualizedReturn, maxDrawdown, sharpeRatio, totalReturn, turnover, winRate } from "../metrics";
import { avgCostEur, derivePortfolio, quantityHeldBefore, valuePortfolio } from "../portfolio";
import { DEFAULT_CONFIG, type LedgerEvent, type Side } from "../types";

const cfg = DEFAULT_CONFIG;
const t = (iso: string) => new Date(iso);

function fillEv(at: string, symbol: string, side: Side, quantity: number, price: number, currency: "EUR" | "USD" = "EUR"): LedgerEvent {
  const fill = buildFill({
    symbol,
    side,
    quantity,
    priceLocal: price,
    refPriceLocal: price,
    currency,
    fx: currency === "USD" ? { currency: "USD", rate: 1.1, source: "fx", time: t(at) } : null,
    config: cfg,
    at: t(at),
    priceSource: "test",
    priceTime: t(at),
  });
  return { type: "fill", at: t(at), fill };
}

describe("cartera derivada del registro", () => {
  it("calcula precio medio con comisiones y P&L realizado", () => {
    const s = derivePortfolio(10_000, [
      fillEv("2026-10-19T10:00:00Z", "SAP.DE", "buy", 10, 100),
      fillEv("2026-10-20T10:00:00Z", "SAP.DE", "buy", 10, 120),
      fillEv("2026-10-21T10:00:00Z", "SAP.DE", "sell", 10, 130),
    ]);
    const p = s.positions.get("SAP.DE")!;
    expect(p.quantity).toBe(10);
    // Coste: 1000+1 + 1200+1.2 = 2202.2 → medio 110.11; se venden 10 → coste salida 1101.1
    expect(avgCostEur(p)).toBeCloseTo(110.11, 6);
    expect(s.realizedPnlEur).toBeCloseTo(1300 - 1.3 - 1101.1, 6);
    expect(s.cashEur).toBe(10_000 - 1001 - 1201.2 + 1298.7);
    expect(s.commissionsEur).toBeCloseTo(3.5, 6);
    expect(s.closedTrades).toHaveLength(1);
  });

  it("elimina la posición al venderla entera", () => {
    const s = derivePortfolio(10_000, [
      fillEv("2026-10-19T10:00:00Z", "SAP.DE", "buy", 5, 100),
      fillEv("2026-10-20T10:00:00Z", "SAP.DE", "sell", 5, 90),
    ]);
    expect(s.positions.size).toBe(0);
    expect(winRate(s.closedTrades)).toBe(0);
  });

  it("abona dividendos y aplica splits", () => {
    const s = derivePortfolio(10_000, [
      fillEv("2026-10-19T10:00:00Z", "AAPL", "buy", 4, 300, "USD"),
      { type: "dividend", at: t("2026-11-10T00:00:00Z"), symbol: "AAPL", cashEur: 0.95 },
      { type: "split", at: t("2026-12-01T00:00:00Z"), symbol: "AAPL", ratio: 4 },
    ]);
    expect(s.positions.get("AAPL")!.quantity).toBe(16);
    expect(s.dividendsEur).toBe(0.95);
  });

  it("no permite vender sin posición", () => {
    expect(() => derivePortfolio(10_000, [fillEv("2026-10-19T10:00:00Z", "SAP.DE", "sell", 1, 100)])).toThrow();
  });

  it("cantidad poseída antes de una fecha (para dividendos)", () => {
    const evs = [fillEv("2026-10-19T10:00:00Z", "SAP.DE", "buy", 5, 100), fillEv("2026-10-25T10:00:00Z", "SAP.DE", "buy", 5, 100)];
    expect(quantityHeldBefore(evs, "SAP.DE", t("2026-10-20T00:00:00Z"))).toBe(5);
    expect(quantityHeldBefore(evs, "SAP.DE", t("2026-10-30T00:00:00Z"))).toBe(10);
  });

  it("valora en EUR convirtiendo USD", () => {
    const s = derivePortfolio(10_000, [fillEv("2026-10-19T10:00:00Z", "AAPL", "buy", 10, 300, "USD")]);
    const v = valuePortfolio(s, new Map([["AAPL", 330]]), { USD: 1.1 });
    expect(v.positionsValueEur).toBe(3000);
    expect(v.missingPrices).toEqual([]);
    const missing = valuePortfolio(s, new Map(), { USD: 1.1 });
    expect(missing.missingPrices).toEqual(["AAPL"]);
  });
});

describe("órdenes limitadas pendientes", () => {
  const order: PendingOrder = {
    symbol: "SAP.DE",
    side: "buy",
    quantity: 10,
    limitPrice: 190,
    reservedCashEur: 1901.9,
    placedAt: t("2026-10-19T14:30:00Z"),
    expiresAt: t("2026-10-19T15:30:00Z"),
  };
  const bar = (iso: string, low: number, high: number) => ({ start: t(iso), low, high });
  const base = { currency: "EUR" as const, fx: null, config: cfg, source: "test" };

  it("se ejecuta al precio límite si una barra posterior lo toca", () => {
    const out = resolvePendingOrder({
      ...base,
      order,
      now: t("2026-10-19T20:00:00Z"),
      bars: [bar("2026-10-19T14:00:00Z", 180, 200), bar("2026-10-19T14:50:00Z", 189.5, 195)],
    });
    expect(out.status).toBe("filled");
    if (out.status === "filled") {
      expect(out.fill.priceLocal).toBe(190);
      expect(out.fill.commissionEur).toBe(1.9);
      expect(out.fill.executedAt.toISOString()).toBe("2026-10-19T14:55:00.000Z");
    }
  });

  it("ignora barras anteriores a la orden y caduca al cierre", () => {
    const out = resolvePendingOrder({ ...base, order, now: t("2026-10-19T20:00:00Z"), bars: [bar("2026-10-19T14:00:00Z", 180, 200)] });
    expect(out.status).toBe("expired");
  });

  it("sigue pendiente si la sesión no ha terminado", () => {
    const out = resolvePendingOrder({ ...base, order, now: t("2026-10-19T15:00:00Z"), bars: [bar("2026-10-19T14:40:00Z", 195, 200)] });
    expect(out.status).toBe("pending");
  });

  it("venta limitada se ejecuta si el máximo alcanza el límite", () => {
    const out = resolvePendingOrder({
      ...base,
      order: { ...order, side: "sell", limitPrice: 210 },
      now: t("2026-10-19T20:00:00Z"),
      bars: [bar("2026-10-19T15:00:00Z", 200, 210.2)],
    });
    expect(out.status).toBe("filled");
  });
});

describe("benchmarks", () => {
  it("compra unidades enteras con comisión y deja el resto en efectivo", () => {
    const b = initBenchmark("MSCI_WORLD", 10_000, 130.55, 1, cfg);
    // precio con slippage 130.615275 → 76 unidades = 9926.76 + 9.93 comisión
    expect(b.units).toBe(76);
    expect(b.grossEur + b.commissionEur + b.cashLeftEur).toBeCloseTo(10_000, 6);
    expect(b.cashLeftEur).toBeGreaterThanOrEqual(0);
    expect(benchmarkValueEur(b, 140)).toBeCloseTo(76 * 140 + b.cashLeftEur, 6);
  });

  it("el benchmark de efectivo vale siempre el capital", () => {
    const c = initBenchmark("CASH", 10_000, null, 1, cfg);
    expect(benchmarkValueEur(c, null)).toBe(10_000);
  });
});

describe("métricas", () => {
  const series = [
    { date: "2026-10-19", value: 10_000 },
    { date: "2026-10-20", value: 10_500 },
    { date: "2026-10-21", value: 9_450 },
    { date: "2026-10-22", value: 9_900 },
  ];
  it("máximo drawdown", () => {
    const dd = maxDrawdown(series);
    expect(dd.pct).toBeCloseTo(-0.1, 6);
    expect(dd.peakDate).toBe("2026-10-20");
    expect(dd.troughDate).toBe("2026-10-21");
  });
  it("rentabilidad total y anualizada", () => {
    expect(totalReturn(10_000, 11_000)).toBeCloseTo(0.1, 9);
    expect(annualizedReturn(10_000, 11_000, 10)).toBeNull();
    expect(annualizedReturn(10_000, 11_000, 365)).toBeCloseTo(0.1, 9);
  });
  it("Sharpe con serie plana es nulo y con ganancias es positivo", () => {
    expect(sharpeRatio([{ date: "a", value: 1 }, { date: "b", value: 1 }, { date: "c", value: 1 }], 0)).toBeNull();
    expect(sharpeRatio([{ date: "a", value: 100 }, { date: "b", value: 101 }, { date: "c", value: 103 }], 0)!).toBeGreaterThan(0);
  });
  it("rotación", () => {
    expect(turnover(20_000, series)).toBeCloseTo(10_000 / 9_962.5, 6);
  });
});
