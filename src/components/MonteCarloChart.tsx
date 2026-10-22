"use client";

import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface FanPoint {
  day: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  bench50: number | null;
}

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

/** Abanico de Monte Carlo: bandas 5-95 % y 25-75 % de la cartera, mediana y mediana del benchmark. */
export function MonteCarloChart({ fan, start, benchName }: { fan: FanPoint[]; start: number; benchName: string }) {
  const rows = fan.map((f) => ({
    day: f.day,
    outer: [f.p5 * start, f.p95 * start],
    inner: [f.p25 * start, f.p75 * start],
    median: f.p50 * start,
    bench: f.bench50 !== null ? f.bench50 * start : null,
  }));
  const month = (d: number) => (d === 0 ? "hoy" : `${Math.round(d / 21)} m`);
  return (
    <div className="h-72 sm:h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="day" type="number" domain={[0, "dataMax"]} ticks={[0, 63, 126, 189, 252]} tickFormatter={month} stroke="var(--axis)" tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} />
          <YAxis stroke="var(--axis)" tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} axisLine={false} width={72} domain={["auto", "auto"]} tickFormatter={(v: number) => eur.format(v)} />
          <Tooltip
            cursor={{ stroke: "var(--axis)" }}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--ink)" }}
            labelFormatter={(d) => (Number(d) === 0 ? "Hoy" : `Dentro de ${Math.round(Number(d) / 21)} meses (${d} sesiones)`)}
            formatter={(v, name) => [Array.isArray(v) ? `${eur.format(Number(v[0]))} – ${eur.format(Number(v[1]))}` : eur.format(Number(v)), name]}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--ink-2)" }} />
          <Area dataKey="outer" name="90 % de los escenarios" stroke="none" fill="var(--s-portfolio)" fillOpacity={0.12} isAnimationActive={false} />
          <Area dataKey="inner" name="50 % de los escenarios" stroke="none" fill="var(--s-portfolio)" fillOpacity={0.25} isAnimationActive={false} />
          <Line dataKey="median" name="Escenario mediano (cartera)" stroke="var(--s-portfolio)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
          <Line dataKey="bench" name={`Escenario mediano (${benchName})`} stroke="var(--s-msci)" strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
