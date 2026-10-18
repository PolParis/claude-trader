import { describe, expect, it } from "vitest";
import { computeIndicators, rsi } from "../indicators";

const hist = (closes: number[]) => closes.map((close, i) => ({ date: `2025-01-${String((i % 28) + 1).padStart(2, "0")}`, close }));

describe("indicadores", () => {
  it("RSI: 100 si solo sube, ~0 si solo baja", () => {
    expect(rsi(Array.from({ length: 30 }, (_, i) => 100 + i))).toBe(100);
    expect(rsi(Array.from({ length: 30 }, (_, i) => 100 - i))!).toBeLessThan(1);
    expect(rsi([1, 2, 3])).toBeNull();
  });

  it("rentabilidades por periodo con el precio actual", () => {
    const closes = Array.from({ length: 300 }, () => 100);
    const ind = computeIndicators(hist(closes), 110);
    expect(ind.ret5d).toBeCloseTo(0.1, 9);
    expect(ind.ret1y).toBeCloseTo(0.1, 9);
    expect(ind.fromHigh52w).toBe(0);
    expect(ind.vsSma50!).toBeGreaterThan(0);
  });

  it("devuelve null si no hay histórico suficiente", () => {
    const ind = computeIndicators(hist([100, 101]), 102);
    expect(ind.ret1m).toBeNull();
    expect(ind.vol3m).toBeNull();
    expect(ind.vsSma200).toBeNull();
  });

  it("drawdown del último año", () => {
    const closes = [...Array.from({ length: 100 }, () => 100), ...Array.from({ length: 100 }, () => 80)];
    expect(computeIndicators(hist(closes), 90).maxDd1y).toBeCloseTo(-0.2, 9);
  });
});
