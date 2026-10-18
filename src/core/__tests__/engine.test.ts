import { describe, expect, it } from "vitest";
import { executeOrders, type EngineInput, type PendingOrder } from "../engine";
import { commissionEur, slippedPrice } from "../fees";
import { derivePortfolio } from "../portfolio";
import { DEFAULT_CONFIG, type Instrument, type OrderRequest, type Quote } from "../types";

const NOW = new Date("2026-10-19T14:00:00Z"); // lunes: Xetra (16:00) y EE. UU. (10:00) abiertos
const cfg = DEFAULT_CONFIG;

const inst = (symbol: string, market: Instrument["market"], currency: Instrument["currency"] = "EUR"): Instrument => ({
  symbol,
  name: symbol,
  market,
  currency,
  kind: "stock",
  region: "test",
});
const quote = (symbol: string, price: number, extra: Partial<Quote> = {}): Quote => ({
  symbol,
  price,
  currency: "EUR",
  source: "test",
  quoteTime: new Date(NOW.getTime() - 60_000),
  fetchedAt: NOW,
  declaredDelayMin: 0,
  marketState: "REGULAR",
  ...extra,
});

function input(orders: OrderRequest[], over: Partial<EngineInput> = {}): EngineInput {
  return {
    config: cfg,
    now: NOW,
    portfolio: derivePortfolio(10_000, []),
    pending: [],
    instruments: new Map([
      ["SAP.DE", inst("SAP.DE", "XETRA")],
      ["AAPL", inst("AAPL", "US", "USD")],
      ["BTC-EUR", { ...inst("BTC-EUR", "CRYPTO"), kind: "crypto" }],
    ]),
    quotes: new Map([
      ["SAP.DE", quote("SAP.DE", 200)],
      ["AAPL", quote("AAPL", 300, { currency: "USD" })],
      ["BTC-EUR", quote("BTC-EUR", 60000)],
    ]),
    fx: { USD: { currency: "USD", rate: 1.1, source: "test-fx", time: NOW } },
    orders,
    ...over,
  };
}

const buy = (symbol: string, quantity: number, extra: Partial<OrderRequest> = {}): OrderRequest => ({
  symbol,
  side: "buy",
  quantity,
  type: "market",
  ...extra,
});
const sell = (symbol: string, quantity: number, extra: Partial<OrderRequest> = {}): OrderRequest => ({
  symbol,
  side: "sell",
  quantity,
  type: "market",
  ...extra,
});

describe("comisiones y slippage", () => {
  it("aplica el mínimo de 1 €", () => {
    expect(commissionEur(200, cfg)).toBe(1);
    expect(commissionEur(2000, cfg)).toBe(2);
  });
  it("slippage en contra", () => {
    expect(slippedPrice(200, "buy", cfg)).toBe(200.1);
    expect(slippedPrice(200, "sell", cfg)).toBe(199.9);
  });
});

describe("motor de ejecución", () => {
  it("compra en EUR con slippage y comisión", () => {
    const out = executeOrders(input([buy("SAP.DE", 10)]));
    const r = out.results[0];
    expect(r.status).toBe("filled");
    expect(r.fill!.priceLocal).toBe(200.1);
    expect(r.fill!.grossEur).toBe(2001);
    expect(r.fill!.commissionEur).toBe(2);
    expect(r.fill!.cashDeltaEur).toBe(-2003);
    expect(out.portfolio.cashEur).toBe(7997);
    expect(out.portfolio.positions.get("SAP.DE")!.quantity).toBe(10);
  });

  it("compra en USD convirtiendo con el tipo de cambio y registrándolo", () => {
    const r = executeOrders(input([buy("AAPL", 5)])).results[0];
    expect(r.status).toBe("filled");
    expect(r.fill!.priceLocal).toBe(300.15);
    expect(r.fill!.fxRate).toBe(1.1);
    expect(r.fill!.fxSource).toBe("test-fx");
    expect(r.fill!.grossEur).toBe(1364.32);
    expect(r.fill!.commissionEur).toBe(1.36);
  });

  it("aplica la comisión de cambio si está configurada", () => {
    const r = executeOrders(input([buy("AAPL", 5)], { config: { ...cfg, fxFeePct: 0.0025 } })).results[0];
    expect(r.fill!.fxFeeEur).toBe(3.41);
    expect(r.fill!.cashDeltaEur).toBeCloseTo(-1369.09, 2);
  });

  it("aplica la comisión mínima en operaciones pequeñas", () => {
    const r = executeOrders(input([buy("SAP.DE", 1)])).results[0];
    expect(r.fill!.commissionEur).toBe(1);
  });

  it("rechaza tickers que no estaban en el prompt", () => {
    const r = executeOrders(input([buy("NVDA", 1)])).results[0];
    expect(r.rejectCode).toBe("NOT_IN_UNIVERSE");
  });

  it("rechaza fracciones y cantidades no positivas", () => {
    const out = executeOrders(input([buy("SAP.DE", 1.5), buy("SAP.DE", 0), buy("SAP.DE", -2)]));
    expect(out.results.map((r) => r.rejectCode)).toEqual(["INVALID_QUANTITY", "INVALID_QUANTITY", "INVALID_QUANTITY"]);
  });

  it("rechaza con el mercado cerrado (fin de semana)", () => {
    const r = executeOrders(input([buy("SAP.DE", 1)], { now: new Date("2026-10-17T10:00:00Z") })).results[0];
    expect(r.rejectCode).toBe("MARKET_CLOSED");
  });

  it("rechaza si Yahoo dice que el mercado no está en sesión regular aunque el calendario diga abierto", () => {
    const quotes = new Map([["SAP.DE", quote("SAP.DE", 200, { marketState: "CLOSED" })]]);
    expect(executeOrders(input([buy("SAP.DE", 1)], { quotes })).results[0].rejectCode).toBe("MARKET_CLOSED");
  });

  it("rechaza EE. UU. antes de la apertura aunque Europa esté abierta", () => {
    const now = new Date("2026-10-19T09:00:00Z");
    const out = executeOrders(input([buy("AAPL", 1), buy("SAP.DE", 1)], { now }));
    expect(out.results.find((r) => r.request.symbol === "AAPL")!.rejectCode).toBe("MARKET_CLOSED");
    expect(out.results.find((r) => r.request.symbol === "SAP.DE")!.status).toBe("filled");
  });

  it("rechaza precios demasiado antiguos", () => {
    const quotes = new Map([["SAP.DE", quote("SAP.DE", 200, { quoteTime: new Date(NOW.getTime() - 45 * 60_000) })]]);
    expect(executeOrders(input([buy("SAP.DE", 1)], { quotes })).results[0].rejectCode).toBe("STALE_QUOTE");
  });

  it("rechaza sin tipo de cambio", () => {
    expect(executeOrders(input([buy("AAPL", 1)], { fx: {} })).results[0].rejectCode).toBe("NO_FX");
  });

  it("rechaza cripto si está desactivada", () => {
    expect(executeOrders(input([buy("BTC-EUR", 1)])).results[0].rejectCode).toBe("CRYPTO_DISABLED");
  });

  it("rechaza por falta de efectivo", () => {
    const cheap = new Map([["SAP.DE", quote("SAP.DE", 2)]]);
    const r = executeOrders(input([buy("SAP.DE", 6000)], { quotes: cheap })).results[0];
    expect(r.rejectCode).toBe("INSUFFICIENT_CASH");
  });

  it("respeta el límite del 25 % por activo", () => {
    expect(executeOrders(input([buy("SAP.DE", 13)])).results[0].rejectCode).toBe("MAX_POSITION");
    expect(executeOrders(input([buy("SAP.DE", 12)])).results[0].status).toBe("filled");
  });

  it("el límite del 25 % cuenta lo ya comprado en la misma ejecución", () => {
    const out = executeOrders(input([buy("SAP.DE", 8), buy("SAP.DE", 5)]));
    expect(out.results.map((r) => r.status)).toEqual(["filled", "rejected"]);
  });

  it("rechaza vender más de lo que se tiene (sin cortos)", () => {
    expect(executeOrders(input([sell("SAP.DE", 1)])).results[0].rejectCode).toBe("INSUFFICIENT_SHARES");
  });

  it("ejecuta primero las ventas y luego las compras", () => {
    const first = executeOrders(input([buy("SAP.DE", 12)]));
    // Con solo 100 € de efectivo la compra solo es posible si antes se vende SAP.
    const second = executeOrders({
      ...input([buy("AAPL", 2), sell("SAP.DE", 12)]),
      portfolio: { ...first.portfolio, cashEur: 100 },
    });
    expect(second.results[0].request.side).toBe("sell");
    expect(second.results.map((r) => r.status)).toEqual(["filled", "filled"]);
  });

  it("orden limitada no ejecutable queda pendiente hasta el cierre y reserva efectivo", () => {
    const out = executeOrders(input([buy("SAP.DE", 10, { type: "limit", limitPrice: 190 }), buy("AAPL", 30)]));
    const lim = out.results.find((r) => r.request.symbol === "SAP.DE")!;
    expect(lim.status).toBe("pending");
    expect(lim.pending!.expiresAt.toISOString()).toBe("2026-10-19T15:30:00.000Z"); // 17:30 Berlín
    expect(lim.pending!.reservedCashEur).toBe(1901.9);
    // 30 AAPL ≈ 8.200 €: con la reserva no hay efectivo suficiente.
    expect(out.results.find((r) => r.request.symbol === "AAPL")!.rejectCode).toBe("INSUFFICIENT_CASH");
    expect(out.portfolio.cashEur).toBe(10_000);
  });

  it("orden limitada ejecutable se ejecuta al momento sin superar el límite", () => {
    const r = executeOrders(input([buy("SAP.DE", 10, { type: "limit", limitPrice: 200.05 })])).results[0];
    expect(r.status).toBe("filled");
    expect(r.fill!.priceLocal).toBe(200.05);
  });

  it("rechaza órdenes limitadas sin precio", () => {
    expect(executeOrders(input([buy("SAP.DE", 1, { type: "limit" })])).results[0].rejectCode).toBe("INVALID_LIMIT");
  });

  it("las ventas pendientes bloquean esas acciones", () => {
    const first = executeOrders(input([buy("SAP.DE", 10)]));
    const pending: PendingOrder[] = [
      { symbol: "SAP.DE", side: "sell", quantity: 8, limitPrice: 250, reservedCashEur: 0, placedAt: NOW, expiresAt: NOW },
    ];
    const r = executeOrders({ ...input([sell("SAP.DE", 5)]), portfolio: first.portfolio, pending }).results[0];
    expect(r.rejectCode).toBe("INSUFFICIENT_SHARES");
  });

  it("no modifica la cartera de entrada", () => {
    const inp = input([buy("SAP.DE", 10)]);
    executeOrders(inp);
    expect(inp.portfolio.cashEur).toBe(10_000);
    expect(inp.portfolio.positions.size).toBe(0);
  });
});
