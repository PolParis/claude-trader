// Esquema estricto de la respuesta de Claude. Se valida con zod; el mismo esquema se pasa
// a `claude -p --json-schema` para que la salida venga ya estructurada.
import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);

export const DecisionSchema = z
  .object({
    journal: z
      .object({
        summary: text(300).describe("Resumen de la decisión en una o dos frases"),
        market_view: text(2000).describe("Lectura del mercado con los datos recibidos"),
        thesis: text(4000).describe("Tesis de inversión que justifica la cartera/órdenes"),
        risks: text(2000).describe("Riesgos principales"),
        data_used: text(2000).describe("Qué datos concretos del prompt se han usado"),
        change_mind: text(1500).describe("Qué tendría que pasar para cambiar de opinión"),
        horizon: text(300).describe("Horizonte temporal"),
      })
      .strict(),
    orders: z
      .array(
        z
          .object({
            symbol: z.string().trim().min(1).max(20),
            side: z.enum(["buy", "sell"]),
            quantity: z.number().positive(),
            type: z.enum(["market", "limit"]),
            limit_price: z.number().positive().nullable(),
            rationale: text(800),
          })
          .strict(),
      )
      .max(20),
    watchlist_changes: z
      .array(
        z
          .object({
            symbol: z.string().trim().min(1).max(20),
            action: z.enum(["add", "remove"]),
            reason: text(500),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();

export type Decision = z.infer<typeof DecisionSchema>;

export function decisionJsonSchema(): string {
  const schema = z.toJSONSchema(DecisionSchema, { target: "draft-7" }) as Record<string, unknown>;
  delete schema.$schema;
  return JSON.stringify(schema);
}

/** Extrae el JSON de la respuesta (acepta salida estructurada o texto con ```json). */
export function parseDecision(raw: unknown): { ok: true; decision: Decision } | { ok: false; error: string } {
  let value: unknown = raw;
  if (typeof raw === "string") {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fenced ? fenced[1] : raw;
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start < 0 || end < start) return { ok: false, error: "La respuesta no contiene JSON" };
    try {
      value = JSON.parse(body.slice(start, end + 1));
    } catch (e) {
      return { ok: false, error: `JSON inválido: ${(e as Error).message}` };
    }
  }
  const parsed = DecisionSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: `No cumple el esquema: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  }
  return { ok: true, decision: parsed.data };
}
