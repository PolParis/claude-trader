import { verifyChain, type ChainReport, type ChainRow } from "@/core/hash";
import { NoExperiment, Section } from "@/components/ui";
import { getContext, type Row } from "@/lib/data";
import { fmtDateTime } from "@/lib/format";

const TABLES: { table: string; label: string }[] = [
  { table: "journal_entries", label: "Diario de Claude" },
  { table: "orders", label: "Órdenes" },
  { table: "fills", label: "Ejecuciones" },
  { table: "order_events", label: "Eventos de órdenes" },
  { table: "corporate_actions", label: "Dividendos y splits" },
  { table: "watchlist_events", label: "Watchlist" },
  { table: "benchmarks", label: "Compra de benchmarks" },
  { table: "snapshots", label: "Valoraciones" },
  { table: "explanations", label: "Explicaciones" },
  { table: "agent_reports", label: "Informes del equipo y academia" },
];

interface Anchor {
  at: string;
  experiment: string;
  heads: Record<string, { seq: number; hash: string } | null>;
}

async function fetchAnchors(): Promise<{ url: string | null; anchors: Anchor[]; error?: string }> {
  const repo = process.env.NEXT_PUBLIC_REPO_URL;
  if (!repo) return { url: null, anchors: [] };
  const m = repo.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!m) return { url: repo, anchors: [], error: "URL de repositorio no válida" };
  const raw = `https://raw.githubusercontent.com/${m[1]}/${m[2].replace(/\.git$/, "")}/main/integrity/anchors.jsonl`;
  try {
    const res = await fetch(raw, { next: { revalidate: 600 } });
    if (!res.ok) return { url: `${repo}/blob/main/integrity/anchors.jsonl`, anchors: [], error: res.status === 404 ? "Todavía no hay anclas" : `HTTP ${res.status}` };
    const anchors = (await res.text())
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Anchor);
    return { url: `${repo}/blob/main/integrity/anchors.jsonl`, anchors };
  } catch (e) {
    return { url: repo, anchors: [], error: (e as Error).message };
  }
}

export default async function IntegridadPage() {
  const { supabase, exp } = await getContext();
  if (!exp) return <NoExperiment />;

  const chains: { table: string; label: string; rows: Row[]; report: ChainReport }[] = [];
  for (const t of TABLES) {
    const rows: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from(t.table).select("*").eq("experiment_id", exp.id).order("seq").range(from, from + 999);
      rows.push(...((data ?? []) as Row[]));
      if (!data || data.length < 1000) break;
    }
    chains.push({ ...t, rows, report: await verifyChain(rows as ChainRow[]) });
  }
  const allOk = chains.every((c) => c.report.ok);

  const { url, anchors, error } = await fetchAnchors();
  const mine = anchors.filter((a) => a.experiment === exp.code);
  const anchorErrors: string[] = [];
  for (const a of mine) {
    for (const c of chains) {
      const h = a.heads[c.table];
      if (!h) continue;
      const row = c.rows.find((r) => Number(r.seq) === h.seq);
      if (!row) anchorErrors.push(`${c.label}: la fila #${h.seq} anclada el ${fmtDateTime(a.at)} ya no existe`);
      else if (row.hash !== h.hash) anchorErrors.push(`${c.label}: la fila #${h.seq} no coincide con el hash anclado el ${fmtDateTime(a.at)}`);
    }
  }

  return (
    <div className="space-y-4">
      <div className={`card p-4 ${allOk && !anchorErrors.length ? "" : "border-bad"}`}>
        <p className={`text-lg font-semibold ${allOk && !anchorErrors.length ? "text-good" : "text-bad"}`}>
          {allOk && !anchorErrors.length ? "✓ Historial íntegro" : "✕ Se han detectado inconsistencias"}
        </p>
        <p className="mt-1 text-sm text-ink-2">
          Verificado al cargar esta página: se recalcula el hash SHA-256 de cada fila a partir de su contenido y se comprueba que cada una
          enlaza con la anterior. Si alguien modificara, borrara o insertara una fila en medio, la cadena se rompería en ese punto.
        </p>
      </div>

      <Section title="Cadenas de hash">
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Registro</th>
                <th className="r">Filas</th>
                <th>Estado</th>
                <th>Último hash</th>
              </tr>
            </thead>
            <tbody>
              {chains.map((c) => (
                <tr key={c.table}>
                  <td>{c.label}</td>
                  <td className="r">{c.report.count}</td>
                  <td>
                    {c.report.ok ? (
                      <span className="text-good">✓ Correcta</span>
                    ) : (
                      <div className="text-bad">
                        ✕ {c.report.errors.length} errores
                        <ul className="text-xs">
                          {c.report.errors.slice(0, 5).map((e, i) => (
                            <li key={i}>#{e.seq}: {e.error}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </td>
                  <td className="font-mono text-xs text-muted" title={c.report.headHash}>
                    {c.report.count ? `${c.report.headHash.slice(0, 16)}…` : "GENESIS"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Anclas públicas en GitHub">
        <p className="text-sm text-ink-2">
          Cada día, tras el cierre, el último hash de cada cadena se publica en un archivo del repositorio público. GitHub guarda la fecha de cada commit, así que
          cualquiera puede comprobar que el historial actual coincide con lo publicado entonces: ni siquiera el dueño de la base de datos podría reescribir el
          pasado sin que se note.
        </p>
        {!url && <p className="mt-2 text-xs text-muted">Falta configurar NEXT_PUBLIC_REPO_URL.</p>}
        {url && (
          <p className="mt-2 text-sm">
            <a href={url} className="text-accent" target="_blank" rel="noreferrer">
              Ver integrity/anchors.jsonl en GitHub →
            </a>
          </p>
        )}
        {error && <p className="mt-2 text-xs text-muted">{error}</p>}
        {mine.length > 0 && (
          <p className={`mt-2 text-sm ${anchorErrors.length ? "text-bad" : "text-good"}`}>
            {anchorErrors.length ? `✕ ${anchorErrors.length} discrepancias con las anclas` : `✓ ${mine.length} anclas comprobadas; la última del ${fmtDateTime(mine.at(-1)!.at)}`}
          </p>
        )}
        {anchorErrors.length > 0 && (
          <ul className="mt-1 text-xs text-bad">
            {anchorErrors.slice(0, 10).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Cómo se protege el historial">
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
          <li>Las tablas de diario, órdenes, ejecuciones, eventos, dividendos, watchlist, benchmarks y valoraciones son <strong>solo de inserción</strong>: unos triggers de la base de datos rechazan cualquier UPDATE, DELETE o TRUNCATE, y esos permisos están retirados a todos los roles de la API.</li>
          <li>Cada fila guarda el JSON exacto de sus datos (<code>payload</code>) y <code>hash = SHA-256(hash_anterior | payload)</code>, calculado por la base de datos al insertar.</li>
          <li>Esta página recalcula toda la cadena de forma independiente y comprueba también que las columnas visibles coinciden con el contenido firmado.</li>
          <li>Límite honesto: el administrador de Postgres podría desactivar los triggers y recalcular toda la cadena. Por eso existen las anclas diarias en GitHub, que no se pueden cambiar con fecha pasada sin reescribir el historial público del repositorio.</li>
        </ul>
      </Section>
    </div>
  );
}
