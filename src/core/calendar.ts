// Horarios de mercado y festivos. Sin librerías: Intl para las zonas horarias y
// reglas propias para los festivos (verificadas en tests contra los calendarios oficiales).
import type { MarketId } from "./types";

type HM = [number, number];

export interface MarketSpec {
  id: MarketId;
  name: string;
  timeZone: string;
  open: HM;
  close: HM;
}

export const MARKETS: Record<MarketId, MarketSpec> = {
  US: { id: "US", name: "EE. UU. (NYSE/Nasdaq)", timeZone: "America/New_York", open: [9, 30], close: [16, 0] },
  XETRA: { id: "XETRA", name: "Xetra (Fráncfort)", timeZone: "Europe/Berlin", open: [9, 0], close: [17, 30] },
  EURONEXT: { id: "EURONEXT", name: "Euronext", timeZone: "Europe/Paris", open: [9, 0], close: [17, 30] },
  BME: { id: "BME", name: "BME (Madrid)", timeZone: "Europe/Madrid", open: [9, 0], close: [17, 30] },
  CRYPTO: { id: "CRYPTO", name: "Cripto (24/7)", timeZone: "UTC", open: [0, 0], close: [24, 0] },
};

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = domingo
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(date)) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: WEEKDAYS[p.weekday],
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convierte una hora local de `timeZone` a un instante UTC. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const o1 = offsetMs(new Date(guess), timeZone);
  let utc = guess - o1;
  const o2 = offsetMs(new Date(utc), timeZone);
  if (o2 !== o1) utc = guess - o2;
  return new Date(utc);
}

export const dateKey = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Fecha (YYYY-MM-DD) en una zona horaria. */
export function localDate(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return dateKey(p.year, p.month, p.day);
}

export const madridDate = (date: Date) => localDate(date, "Europe/Madrid");

// ---------- Festivos ----------

/** Domingo de Pascua (algoritmo gregoriano anónimo). */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function utcDate(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m - 1, d));
}
function keyOf(date: Date) {
  return dateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}
function addDays(date: Date, n: number) {
  return new Date(date.getTime() + n * 86_400_000);
}
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = utcDate(year, month, 1);
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  return addDays(first, shift + (n - 1) * 7);
}
function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = utcDate(year, month + 1, 0);
  const shift = (last.getUTCDay() - weekday + 7) % 7;
  return addDays(last, -shift);
}
/** Regla NYSE: festivo en sábado → viernes; en domingo → lunes. */
function observed(date: Date): Date {
  const wd = date.getUTCDay();
  if (wd === 6) return addDays(date, -1);
  if (wd === 0) return addDays(date, 1);
  return date;
}

export interface DayRule {
  closed?: boolean;
  earlyClose?: HM;
}

const cache = new Map<string, Map<string, DayRule>>();

export function holidays(market: MarketId, year: number): Map<string, DayRule> {
  const ck = `${market}:${year}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const map = new Map<string, DayRule>();
  const closed = (d: Date) => map.set(keyOf(d), { closed: true });
  const early = (d: Date, hm: HM) => {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !map.get(keyOf(d))?.closed) map.set(keyOf(d), { earlyClose: hm });
  };
  const easter = easterSunday(year);
  const easterDate = utcDate(year, easter.month, easter.day);
  const goodFriday = addDays(easterDate, -2);
  const easterMonday = addDays(easterDate, 1);

  switch (market) {
    case "US": {
      const ny = utcDate(year, 1, 1);
      if (ny.getUTCDay() !== 6) closed(observed(ny)); // si cae en sábado la NYSE no lo traslada
      closed(nthWeekday(year, 1, 1, 3)); // Martin Luther King
      closed(nthWeekday(year, 2, 1, 3)); // Presidents' Day
      closed(goodFriday);
      closed(lastWeekday(year, 5, 1)); // Memorial Day
      closed(observed(utcDate(year, 6, 19))); // Juneteenth
      closed(observed(utcDate(year, 7, 4))); // Independence Day
      closed(nthWeekday(year, 9, 1, 1)); // Labor Day
      const thanksgiving = nthWeekday(year, 11, 4, 4);
      closed(thanksgiving);
      closed(observed(utcDate(year, 12, 25))); // Navidad
      early(addDays(thanksgiving, 1), [13, 0]);
      early(utcDate(year, 12, 24), [13, 0]);
      early(utcDate(year, 7, 3), [13, 0]);
      break;
    }
    case "XETRA":
      for (const d of [utcDate(year, 1, 1), goodFriday, easterMonday, utcDate(year, 5, 1), utcDate(year, 12, 24), utcDate(year, 12, 25), utcDate(year, 12, 26), utcDate(year, 12, 31)])
        closed(d);
      break;
    case "EURONEXT":
    case "BME":
      for (const d of [utcDate(year, 1, 1), goodFriday, easterMonday, utcDate(year, 5, 1), utcDate(year, 12, 25), utcDate(year, 12, 26)])
        closed(d);
      early(utcDate(year, 12, 24), market === "EURONEXT" ? [14, 5] : [14, 0]);
      early(utcDate(year, 12, 31), market === "EURONEXT" ? [14, 5] : [14, 0]);
      break;
    case "CRYPTO":
      break;
  }
  cache.set(ck, map);
  return map;
}

export interface Session {
  open: Date;
  close: Date;
}

/** Sesión del día local que contiene `at`, o null si ese día no hay mercado. */
export function sessionFor(market: MarketId, at: Date): Session | null {
  const spec = MARKETS[market];
  if (market === "CRYPTO") {
    const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
    return { open: d, close: addDays(d, 1) };
  }
  const p = zonedParts(at, spec.timeZone);
  if (p.weekday === 0 || p.weekday === 6) return null;
  const rule = holidays(market, p.year).get(dateKey(p.year, p.month, p.day));
  if (rule?.closed) return null;
  const close = rule?.earlyClose ?? spec.close;
  return {
    open: zonedTimeToUtc(p.year, p.month, p.day, spec.open[0], spec.open[1], spec.timeZone),
    close: zonedTimeToUtc(p.year, p.month, p.day, close[0], close[1], spec.timeZone),
  };
}

export function isMarketOpen(market: MarketId, at: Date): boolean {
  const s = sessionFor(market, at);
  return !!s && at >= s.open && at < s.close;
}
