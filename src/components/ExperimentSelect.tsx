"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { selectExperiment } from "@/app/actions";

export function ExperimentSelect({ options, current }: { options: { code: string; name: string; mode: string }[]; current: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (options.length < 2) return null;
  return (
    <select
      value={current}
      disabled={pending}
      onChange={(e) => start(async () => {
        await selectExperiment(e.target.value);
        router.refresh();
      })}
      className="rounded-md border border-line bg-surface px-2 py-1 text-xs"
      aria-label="Experimento"
    >
      {options.map((o) => (
        <option key={o.code} value={o.code}>
          {o.name} {o.mode === "test" ? "(prueba)" : ""}
        </option>
      ))}
    </select>
  );
}
