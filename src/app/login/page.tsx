"use client";

import { useActionState } from "react";
import { login } from "../actions";

export default function LoginPage() {
  const [error, action, pending] = useActionState(login, null);
  return (
    <main className="flex min-h-[80vh] items-center justify-center px-4">
      <form action={action} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <h1 className="text-lg font-semibold">Claude vs. el Mercado</h1>
          <p className="text-sm text-muted">Acceso privado</p>
        </div>
        <label className="block text-sm">
          <span className="text-ink-2">Email</span>
          <input name="email" type="email" required autoComplete="email" className="mt-1 w-full rounded-md border border-line bg-surface-2 px-3 py-2" />
        </label>
        <label className="block text-sm">
          <span className="text-ink-2">Contraseña</span>
          <input name="password" type="password" required autoComplete="current-password" className="mt-1 w-full rounded-md border border-line bg-surface-2 px-3 py-2" />
        </label>
        {error && <p className="text-sm text-bad">{error}</p>}
        <button disabled={pending} className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
          {pending ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
