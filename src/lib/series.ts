import { BENCHMARKS } from "@/core/benchmarks";
import type { SeriesDef } from "@/components/PerformanceChart";

const COLOR: Record<string, string> = {
  MSCI_WORLD: "var(--s-msci)",
  SP500: "var(--s-sp500)",
  EUROSTOXX50: "var(--s-stoxx)",
  CASH: "var(--s-cash)",
};

export const CHART_SERIES: SeriesDef[] = [
  { key: "portfolio", name: "Cartera de Claude", color: "var(--s-portfolio)" },
  ...BENCHMARKS.map((b) => ({ key: b.code, name: b.name, color: COLOR[b.code], dashed: b.code === "CASH" })),
];

export const benchmarkName = (code: string) => BENCHMARKS.find((b) => b.code === code)?.name ?? code;
