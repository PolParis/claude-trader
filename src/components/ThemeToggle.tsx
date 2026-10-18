"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
const LABELS: Record<Theme, string> = { system: "Tema: sistema", light: "Tema: claro", dark: "Tema: oscuro" };
const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    try {
      const t = localStorage.getItem("theme");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (t === "light" || t === "dark") setTheme(t);
    } catch {}
  }, []);
  const change = () => {
    const t = NEXT[theme];
    setTheme(t);
    try {
      if (t === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", t);
    } catch {}
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  };
  return (
    <button onClick={change} className="rounded-md border border-line px-2 py-1 text-xs text-ink-2 hover:bg-surface-2" title="Cambiar tema">
      {LABELS[theme]}
    </button>
  );
}
