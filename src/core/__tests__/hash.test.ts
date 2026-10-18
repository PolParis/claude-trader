import { describe, expect, it } from "vitest";
import { canonicalJson, chainHash, GENESIS, sha256Hex, verifyChain, type ChainRow } from "../hash";

async function buildChain(payloads: Record<string, unknown>[]): Promise<ChainRow[]> {
  const rows: ChainRow[] = [];
  let prev = GENESIS;
  for (const [i, p] of payloads.entries()) {
    const payload = canonicalJson(p);
    const hash = await chainHash(prev, payload);
    rows.push({ seq: i + 1, payload, prev_hash: prev, hash, ...p });
    prev = hash;
  }
  return rows;
}

describe("hash encadenado", () => {
  it("sha256 conocido", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("JSON canónico ordena claves y omite undefined", () => {
    expect(canonicalJson({ b: 1, a: [true, null], c: undefined, d: new Date("2026-01-01T00:00:00Z") })).toBe(
      '{"a":[true,null],"b":1,"d":"2026-01-01T00:00:00.000Z"}',
    );
  });

  it("una cadena íntegra se verifica", async () => {
    const rows = await buildChain([{ symbol: "SAP.DE", qty: 1 }, { symbol: "AAPL", qty: 2 }]);
    const r = await verifyChain(rows);
    expect(r.ok).toBe(true);
    expect(r.headHash).toBe(rows[1].hash);
  });

  it("tolera formatos de Postgres (numeric como texto, timestamptz)", async () => {
    const rows = await buildChain([{ price: 10.5, at: "2026-10-19T14:00:00.000Z" }]);
    rows[0].price = "10.50";
    rows[0].at = "2026-10-19 14:00:00+00";
    expect((await verifyChain(rows)).ok).toBe(true);
  });

  it("detecta una columna modificada", async () => {
    const rows = await buildChain([{ symbol: "SAP.DE", qty: 1 }, { symbol: "AAPL", qty: 2 }]);
    rows[0].qty = 100;
    const r = await verifyChain(rows);
    expect(r.ok).toBe(false);
    expect(r.errors[0].seq).toBe(1);
  });

  it("detecta un payload reescrito y una fila borrada", async () => {
    const rows = await buildChain([{ a: 1 }, { a: 2 }, { a: 3 }]);
    const tampered = [...rows];
    tampered[1] = { ...rows[1], payload: canonicalJson({ a: 99 }), a: 99 };
    expect((await verifyChain(tampered)).ok).toBe(false);
    expect((await verifyChain([rows[0], rows[2]])).ok).toBe(false);
  });
});
