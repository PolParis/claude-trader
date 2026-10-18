import { logout } from "@/app/actions";
import { ExperimentSelect } from "@/components/ExperimentSelect";
import { Nav } from "@/components/Nav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getContext } from "@/lib/data";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { experiments, exp } = await getContext();
  return (
    <div className="mx-auto max-w-6xl px-4">
      <header className="flex flex-wrap items-center justify-between gap-3 pt-5 pb-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Claude vs. el Mercado</h1>
          <p className="text-xs text-muted">Una IA gestiona 10.000 € ficticios con precios reales</p>
        </div>
        <div className="flex items-center gap-2">
          <ExperimentSelect options={experiments.map((e) => ({ code: e.code, name: e.name, mode: e.mode }))} current={exp?.code ?? ""} />
          <ThemeToggle />
          <form action={logout}>
            <button className="rounded-md border border-line px-2 py-1 text-xs text-ink-2 hover:bg-surface-2">Salir</button>
          </form>
        </div>
      </header>
      <Nav />
      {exp?.mode === "test" && (
        <div className="mt-3 rounded-md bg-warn-bg px-3 py-2 text-xs text-warn-ink">
          Estás viendo un <strong>experimento de prueba</strong> ({exp.name}). Sus resultados no cuentan para el experimento oficial.
        </div>
      )}
      <main className="py-6">{children}</main>
    </div>
  );
}
