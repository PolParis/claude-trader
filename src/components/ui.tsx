import type { ReactNode } from "react";

export function Stat({ label, value, sub, valueClass = "" }: { label: string; value: ReactNode; sub?: ReactNode; valueClass?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight ${valueClass}`}>{value}</p>
      {sub && <div className="mt-1 text-xs text-ink-2">{sub}</div>}
    </div>
  );
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted">{children}</p>;
}

const BADGE: Record<string, string> = {
  filled: "Ejecutada",
  rejected: "Rechazada",
  pending: "Pendiente",
  expired: "Caducada",
  cancelled: "Cancelada",
  completed: "Completada",
  failed: "Fallida",
  skipped: "Omitida",
  reserved: "En curso",
};
const BADGE_TONE: Record<string, string> = {
  filled: "text-good",
  completed: "text-good",
  rejected: "text-bad",
  failed: "text-bad",
  pending: "text-warn-ink",
  reserved: "text-warn-ink",
};
const ICON: Record<string, string> = { filled: "✓", completed: "✓", rejected: "✕", failed: "✕", pending: "…", reserved: "…" };

/** Estado con icono + texto (nunca solo color). */
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium ${BADGE_TONE[status] ?? "text-muted"}`}>
      <span aria-hidden>{ICON[status] ?? "–"}</span>
      {BADGE[status] ?? status}
    </span>
  );
}

export function NoExperiment() {
  return <Empty>No hay ningún experimento disponible todavía.</Empty>;
}
