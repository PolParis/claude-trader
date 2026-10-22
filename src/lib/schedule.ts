// Horario de las reuniones programadas (Programador de tareas de Windows, L-V, hora de Madrid).
// Es la única fuente de verdad: lo usan el agente, el cierre diario y la web.
import { zonedParts, zonedTimeToUtc } from "@/core/calendar";

export interface ScheduledSlot {
  slot: string;
  hour: number;
  minute: number;
  label: string;
  /** Minuto del día (Madrid) hasta el que vale lanzarla; si Windows la lanza más tarde, no se hace. */
  until: number;
  /** Preapertura: con los mercados cerrados, el equipo analiza y deja un plan, sin órdenes. */
  briefing?: boolean;
}

export const SCHEDULED_SLOTS: ScheduledSlot[] = [
  { slot: "P0", hour: 8, minute: 30, label: "preapertura 08:30", until: 9 * 60 + 15, briefing: true },
  { slot: "S0", hour: 9, minute: 30, label: "apertura de Europa 09:30", until: 11 * 60 },
  { slot: "S1", hour: 16, minute: 30, label: "programada 16:30", until: 18 * 60 },
  { slot: "S2", hour: 21, minute: 0, label: "programada 21:00", until: 22 * 60 },
];

export const slotInfo = (slot: string) => SCHEDULED_SLOTS.find((s) => s.slot === slot);
export const slotTime = (s: ScheduledSlot) => `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;

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
