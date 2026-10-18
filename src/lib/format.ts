// Formateo en español (es-ES) y zona horaria de Madrid.
const TZ = "Europe/Madrid";

const eurFmt = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const numFmt = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 4 });
const dateTimeFmt = new Intl.DateTimeFormat("es-ES", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
const dateFmt = new Intl.DateTimeFormat("es-ES", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" });
const longFmt = new Intl.DateTimeFormat("es-ES", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export const fmtEur = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : eurFmt.format(v));
export const fmtNum = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : numFmt.format(v));
export function fmtPrice(v: number | null | undefined, currency = "EUR") {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency, maximumFractionDigits: v < 10 ? 4 : 2 }).format(v);
}
export function fmtPct(v: number | null | undefined, signed = true, digits = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = (v * 100).toLocaleString("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${signed && v > 0 ? "+" : ""}${s} %`;
}
export const fmtDateTime = (v: string | Date | null | undefined) => (v ? dateTimeFmt.format(new Date(v)) : "—");
export const fmtDate = (v: string | Date | null | undefined) => (v ? dateFmt.format(new Date(typeof v === "string" && v.length === 10 ? `${v}T12:00:00Z` : v)) : "—");
export const fmtLong = (v: Date) => longFmt.format(v);

export const tone = (v: number | null | undefined) => (v === null || v === undefined || v === 0 ? "text-ink" : v > 0 ? "text-good" : "text-bad");
