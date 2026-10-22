import { describe, expect, it } from "vitest";
import {
  alignReturns,
  correlation,
  factorScores,
  monteCarlo,
  portfolioSeries,
  quantile,
  reviewTrades,
  riskContributions,
  riskStats,
  rng,
  stressTests,
} from "../quant";

const days = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));

describe("estadística básica", () => {
  it("quantile interpola", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([0, 10], 0.25)).toBe(2.5);
  });
  it("correlación de una serie consigo misma = 1 y con su opuesta = -1", () => {
    const a = [0.01, -0.02, 0.03, 0.0, -0.01];
    expect(correlation(a, a)).toBeCloseTo(1);
    expect(correlation(a, a.map((x) => -x))).toBeCloseTo(-1);
  });
  it("rng con semilla es reproducible", () => {
    const a = rng(42);
    const b = rng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("alignReturns", () => {
  it("convierte USD a EUR y rellena festivos", () => {
    const d = days(4);
    const histories = new Map([
      ["US", d.map((date, i) => ({ date, close: 100 * (1 + i * 0.01) }))],
      ["EU", [d[0], d[1], d[3]].map((date) => ({ date, close: 50 }))], // d[2] festivo
    ]);
    const fx = d.map((date) => ({ date, close: 1 })); // EUR/USD constante
    const m = alignReturns(histories, new Map([["US", "USD"], ["EU", "EUR"]]), fx, { minHistory: 2 });
    expect(m.dates).toEqual(d.slice(1));
    expect(m.returns[1][1]).toBe(0); // festivo: precio repetido
    expect(m.returns[0][0]).toBeCloseTo(0.01);
  });
  it("si el dólar baja frente al euro, el activo en USD pierde en EUR", () => {
    const d = days(2);
    const m = alignReturns(new Map([["US", d.map((date) => ({ date, close: 100 }))]]), new Map([["US", "USD"]]), [
      { date: d[0], close: 1.0 },
      { date: d[1], close: 1.1 },
    ], { minHistory: 2 });
    expect(m.returns[0][0]).toBeCloseTo(1 / 1.1 - 1);
  });
});

describe("riesgo", () => {
  const n = 60;
  const d = days(n + 1);
  const r = rng(1);
  const a = d.map(() => 0);
  let pa = 100;
  let pb = 100;
  const ha = d.map((date) => ({ date, close: (pa *= 1 + (r() - 0.5) * 0.04) }));
  const hb = d.map((date) => ({ date, close: (pb *= 1 + (r() - 0.5) * 0.01) }));
  void a;
  const m = alignReturns(new Map([["A", ha], ["B", hb]]), new Map(), [], { minHistory: 2 });
  const w = { A: 0.4, B: 0.4 };

  it("las contribuciones al riesgo suman 1 y el activo más volátil aporta más", () => {
    const rc = riskContributions(m, w);
    expect(rc.reduce((s, x) => s + x.contribution, 0)).toBeCloseTo(1);
    expect(rc[0].symbol).toBe("A");
  });
  it("beta de una cartera frente a sí misma = 1", () => {
    const s = portfolioSeries(m, w);
    const st = riskStats(s, s);
    expect(st.beta).toBeCloseTo(1);
    expect(st.var95_1d).toBeGreaterThan(0);
    expect(st.cvar95_1d).toBeGreaterThanOrEqual(st.var95_1d);
  });
  it("Monte Carlo es reproducible, ordenado y con efectivo no pierde nada", () => {
    const s = portfolioSeries(m, w);
    const x = monteCarlo(s, s, { seed: 7, paths: 500, horizonDays: 50 })!;
    const y = monteCarlo(s, s, { seed: 7, paths: 500, horizonDays: 50 })!;
    expect(x.final).toEqual(y.final);
    expect(x.final.p5).toBeLessThanOrEqual(x.final.p50);
    expect(x.final.p50).toBeLessThanOrEqual(x.final.p95);
    expect(x.probBeatBench).toBe(0); // misma serie: nunca le gana
    const cash = monteCarlo(s.map(() => 0), null, { seed: 7, paths: 100, horizonDays: 30 })!;
    expect(cash.final.p5).toBe(1);
    expect(cash.probLoss).toBe(0);
  });
  it("pruebas de estrés devuelven el peor mes", () => {
    const s = portfolioSeries(m, w);
    const st = stressTests(m, s, s, 21);
    expect(st[0].portfolio).toBeCloseTo(st[0].bench!);
    expect(st.length).toBe(3);
  });
});

describe("factores y post-mortem", () => {
  it("ordena primero el activo con mejores factores", () => {
    const f = factorScores([
      { symbol: "BUENO", ret1y: 0.5, ret1m: 0.02, vsSma200: 0.2, vol3m: 0.15, forwardPE: 10 },
      { symbol: "MEDIO", ret1y: 0.1, ret1m: 0.0, vsSma200: 0.0, vol3m: 0.25, forwardPE: 20 },
      { symbol: "MALO", ret1y: -0.3, ret1m: -0.05, vsSma200: -0.2, vol3m: 0.5, forwardPE: 60 },
    ]);
    expect(f.map((x) => x.symbol)).toEqual(["BUENO", "MEDIO", "MALO"]);
  });
  it("una compra que sube más que el benchmark es un acierto; una venta antes de una caída también", () => {
    const now = new Date("2026-02-01");
    const res = reviewTrades(
      [
        { symbol: "X", side: "buy", at: new Date("2026-01-01"), priceEur: 100 },
        { symbol: "Y", side: "sell", at: new Date("2026-01-01"), priceEur: 100 },
      ],
      new Map([["X", 110], ["Y", 90]]),
      () => 100,
      102,
      now,
    );
    expect(res.trades[0].excess).toBeCloseTo(0.08);
    expect(res.trades[1].excess).toBeCloseTo(0.12);
    expect(res.hitRate).toBe(1);
  });
});

describe("neutralDrift", () => {
  it("quita la tendencia y deja la deriva pedida", async () => {
    const { neutralDrift, mean, std } = await import("../quant");
    const s = [0.02, 0.03, 0.01, 0.04];
    const n = neutralDrift(s, 0);
    expect(mean(n)).toBeCloseTo(0);
    expect(std(n)).toBeCloseTo(std(s));
  });
});
