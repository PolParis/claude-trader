"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Resumen" },
  { href: "/explicaciones", label: "Explicaciones" },
  { href: "/posiciones", label: "Posiciones" },
  { href: "/operaciones", label: "Operaciones" },
  { href: "/diario", label: "Diario de Claude" },
  { href: "/metricas", label: "Métricas" },
  { href: "/metodologia", label: "Metodología" },
  { href: "/integridad", label: "Integridad" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 text-sm">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 ${active ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
