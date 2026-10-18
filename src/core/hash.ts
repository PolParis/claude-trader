// Hash encadenado. Cada fila guarda `payload` (JSON canónico de sus datos), `prev_hash` y
// `hash = sha256(prev_hash + "|" + payload)`. La BD lo calcula en un trigger al insertar;
// esta función lo recalcula de forma independiente para demostrar que nada se ha alterado.

export const GENESIS = "GENESIS";

/** JSON con claves ordenadas, sin `undefined` y con fechas ISO: misma entrada → mismo texto. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Número no finito en payload: ${value}`);
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  throw new Error(`Tipo no serializable: ${typeof value}`);
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const chainHash = (prevHash: string, payload: string) => sha256Hex(`${prevHash}|${payload}`);

const ISO_TS = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/** Compara un valor del payload con el de la columna tolerando formatos de Postgres (numeric como texto, timestamptz). */
export function looselyEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === "number" || typeof b === "number") {
    const x = Number(a);
    const y = Number(b);
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x));
  }
  if (typeof a === "string" && typeof b === "string") {
    if (ISO_TS.test(a) && ISO_TS.test(b)) return new Date(a).getTime() === new Date(b).getTime();
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => looselyEqual(x, b[i]));
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
    const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
    const keys = new Set([...ka, ...kb]);
    return [...keys].every((k) => looselyEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

export interface ChainRow {
  seq: number | string;
  payload: string;
  prev_hash: string;
  hash: string;
  [column: string]: unknown;
}

export interface ChainReport {
  ok: boolean;
  count: number;
  headHash: string;
  errors: { seq: number; error: string }[];
}

/** Verifica una cadena completa (filas de un experimento y una tabla). */
export async function verifyChain(rows: ChainRow[]): Promise<ChainReport> {
  const sorted = [...rows].sort((a, b) => Number(a.seq) - Number(b.seq));
  const errors: ChainReport["errors"] = [];
  let prev = GENESIS;
  let expectedSeq = 1;
  for (const row of sorted) {
    const seq = Number(row.seq);
    if (seq !== expectedSeq) errors.push({ seq, error: `Falta la fila ${expectedSeq} (hueco en la secuencia)` });
    expectedSeq = seq + 1;
    if (row.prev_hash !== prev) errors.push({ seq, error: "prev_hash no coincide con el hash anterior" });
    const h = await chainHash(row.prev_hash, row.payload);
    if (h !== row.hash) errors.push({ seq, error: "El hash no corresponde al contenido (payload alterado)" });
    try {
      const parsed = JSON.parse(row.payload) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        if (k in row && !looselyEqual(v, row[k])) errors.push({ seq, error: `La columna "${k}" no coincide con el payload firmado` });
      }
    } catch {
      errors.push({ seq, error: "payload no es JSON válido" });
    }
    prev = row.hash;
  }
  return { ok: errors.length === 0, count: sorted.length, headHash: prev, errors };
}
