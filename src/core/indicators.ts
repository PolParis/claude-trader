// Indicadores calculados a partir del histórico diario de cierres. Se dan a Claude ya
// calculados para que no tenga que (ni pueda) usar datos de memoria.

export interface DailyClose {
  date: string; // YYYY-MM-DD
  close: number;
}

export interface Indicators {
  ret5d: number | null;
  ret1m: number | null;
  ret3m: number | null;
  ret6m: number | null;
  ret1y: number | null;
  ytd: number | null;
  vol3m: number | null; // volatilidad anualizada de 63 sesiones
  rsi14: number | null;
  vsSma50: number | null; // precio / media 50 − 1
  vsSma200: number | null;
  fromHigh52w: number | null; // precio / máximo 52 semanas − 1
  maxDd1y: number | null;
}

function retOver(closes: number[], sessions: number, last: number): number | null {
  if (closes.length <= sessions) return null;
  const base = closes[closes.length - 1 - sessions];
  return base > 0 ? last / base - 1 : null;
}

function sma(xs: number[], n: number): number | null {
  if (xs.length < n) return null;
  return xs.slice(-n).reduce((s, x) => s + x, 0) / n;
}

export function rsi(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

/** `history` ordenado por fecha ascendente; `lastPrice` = precio actual (puede ser intradía). */
export function computeIndicators(history: DailyClose[], lastPrice: number): Indicators {
  const closes = history.map((h) => h.close).filter((c) => Number.isFinite(c) && c > 0);
  const series = [...closes, lastPrice];
  const year = new Date().getUTCFullYear();
  const firstOfYear = history.find((h) => h.date >= `${year}-01-01`);
  const prevYearEnd = [...history].reverse().find((h) => h.date < `${year}-01-01`);
  const ytdBase = prevYearEnd?.close ?? firstOfYear?.close;

  const rets: number[] = [];
  const window = series.slice(-64);
  for (let i = 1; i < window.length; i++) rets.push(window[i] / window[i - 1] - 1);
  let vol3m: number | null = null;
  if (rets.length >= 20) {
    const m = rets.reduce((s, x) => s + x, 0) / rets.length;
    vol3m = Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252);
  }

  const lastYear = series.slice(-253);
  const high = lastYear.length ? Math.max(...lastYear) : null;
  let peak = -Infinity;
  let dd = 0;
  for (const c of lastYear) {
    peak = Math.max(peak, c);
    dd = Math.min(dd, c / peak - 1);
  }
  const s50 = sma(series, 50);
  const s200 = sma(series, 200);

  return {
    ret5d: retOver(series, 5, lastPrice),
    ret1m: retOver(series, 21, lastPrice),
    ret3m: retOver(series, 63, lastPrice),
    ret6m: retOver(series, 126, lastPrice),
    ret1y: retOver(series, 252, lastPrice),
    ytd: ytdBase ? lastPrice / ytdBase - 1 : null,
    vol3m,
    rsi14: rsi(series),
    vsSma50: s50 ? lastPrice / s50 - 1 : null,
    vsSma200: s200 ? lastPrice / s200 - 1 : null,
    fromHigh52w: high ? lastPrice / high - 1 : null,
    maxDd1y: lastYear.length > 20 ? dd : null,
  };
}
