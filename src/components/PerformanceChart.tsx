"use client";

import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface SeriesDef {
  key: string;
  name: string;
  color: string;
  dashed?: boolean;
}

const dateFmt = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "short" });
const tipFmt = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "medium", timeStyle: "short" });
const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

export function PerformanceChart({ data, series, initial }: { data: Record<string, number | string>[]; series: SeriesDef[]; initial: number }) {
  const [mode, setMode] = useState<"eur" | "pct">("pct");
  const rows =
    mode === "eur"
      ? data
      : data.map((d) => {
          const o: Record<string, number | string> = { ...d };
          for (const s of series) if (typeof d[s.key] === "number") o[s.key] = ((d[s.key] as number) / initial - 1) * 100;
          return o;
        });
  const fmtVal = (v: number) => (mode === "eur" ? eur2.format(v) : `${v > 0 ? "+" : ""}${v.toLocaleString("es-ES", { maximumFractionDigits: 2 })} %`);

  if (data.length < 2) {
    return <p className="py-16 text-center text-sm text-muted">El gráfico aparecerá cuando haya al menos dos valoraciones de la cartera.</p>;
  }
  return (
    <div>
      <div className="mb-2 flex justify-end gap-1 text-xs">
        {(["pct", "eur"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-md px-2 py-1 ${mode === m ? "bg-surface-2 font-medium text-ink" : "text-muted hover:bg-surface-2"}`}
          >
            {m === "pct" ? "Rentabilidad %" : "Valor €"}
          </button>
        ))}
      </div>
      <div className="h-72 sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t) => dateFmt.format(new Date(t))}
              stroke="var(--axis)"
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              stroke="var(--axis)"
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={mode === "eur" ? 72 : 52}
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => (mode === "eur" ? eur.format(v) : `${v.toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`)}
            />
            <Tooltip
              cursor={{ stroke: "var(--axis)" }}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--ink)" }}
              labelFormatter={(t) => tipFmt.format(new Date(Number(t)))}
              formatter={(v, name) => [fmtVal(Number(v)), name]}
              itemSorter={(item) => -Number(item.value)}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: "var(--ink-2)" }} iconType="plainline" />
            {series.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={s.key === "portfolio" ? 2.5 : 2}
                strokeDasharray={s.dashed ? "4 4" : undefined}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
