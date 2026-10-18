// Horario de las ejecuciones programadas en el Programador de tareas (L-V, hora de Madrid).
import { zonedParts, zonedTimeToUtc } from "@/core/calendar";

export const SCHEDULED_SLOTS = [
  { slot: "S1", hour: 16, minute: 30 },
  { slot: "S2", hour: 21, minute: 0 },
];

export function nextScheduledRun(now: Date): { slot: string; at: Date } {
  for (let d = 0; d < 8; d++) {
    const day = new Date(now.getTime() + d * 86_400_000);
    const p = zonedParts(day, "Europe/Madrid");
    if (p.weekday === 0 || p.weekday === 6) continue;
    for (const s of SCHEDULED_SLOTS) {
      const at = zonedTimeToUtc(p.year, p.month, p.day, s.hour, s.minute, "Europe/Madrid");
      if (at > now) return { slot: s.slot, at };
    }
  }
  throw new Error("Sin próxima ejecución");
}
