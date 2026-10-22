"use client";

import { useState } from "react";

export interface OfficeAgent {
  id: string;
  name: string;
  role: string;
  ai: boolean; // true = Claude, false = código
  hair: string;
  desk: { x: number; y: number };
  seat: { x: number; y: number } | null; // sitio en la sala de reuniones (null = no va)
  slot: [number, number] | null; // fracción del ciclo en la que está en la reunión
  bubble: string | null;
}

const CYCLE_S = 32;
const SIT = 34; // la persona se dibuja por encima de su mesa

/** Keyframes de cada agente: en su mesa → camina a la sala → vuelve. */
function keyframes(a: OfficeAgent): string {
  if (!a.seat || !a.slot) return "";
  const dx = a.seat.x - a.desk.x;
  const dy = a.seat.y - (a.desk.y - SIT);
  const [s, e] = a.slot.map((v) => v * 100);
  const walk = 4;
  return (
    `@keyframes walk-${a.id}{0%,${s}%{transform:translate(0,0)}${s + walk}%,${e - walk}%{transform:translate(${dx}px,${dy}px)}${e}%,100%{transform:translate(0,0)}}` +
    `@keyframes say-${a.id}{0%,${s + walk}%{opacity:0}${s + walk + 1}%,${e - walk - 1}%{opacity:1}${e - walk}%,100%{opacity:0}}`
  );
}

// Bocadillo a la izquierda para quien se sienta en la mitad izquierda de la mesa (no se pisan).
const bubbleW = (t: string) => Math.min(230, 16 + t.length * 5.6);
const bubbleX = (a: OfficeAgent) => (a.seat && a.seat.x < 480 ? -bubbleW(a.bubble ?? "") - 10 : 10);

function Person({ hair, ai }: { hair: string; ai: boolean }) {
  return (
    <g>
      <ellipse cx="0" cy="17" rx="13" ry="3" fill="var(--border)" />
      <rect x="-11" y="-2" width="22" height="18" rx="8" fill={ai ? "var(--s-portfolio)" : "var(--s-cash)"} />
      <circle cx="0" cy="-10" r="9" fill="#f1c9a5" />
      <path d="M-9,-11 a9,9 0 0,1 18,0 q-4,-4 -9,-3 q-5,-1 -9,3z" fill={hair} />
      <circle cx="-3" cy="-9" r="1.1" fill="#3b2a20" />
      <circle cx="3" cy="-9" r="1.1" fill="#3b2a20" />
    </g>
  );
}

export function Office({ agents, live, caption }: { agents: OfficeAgent[]; live: boolean; caption: string }) {
  const [playing, setPlaying] = useState(true);
  const css =
    agents.map(keyframes).join("") +
    `@keyframes type{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}@keyframes glow{0%,100%{opacity:.35}50%{opacity:.9}}` +
    // Quien prefiere menos movimiento ve la oficina quieta.
    `@media (prefers-reduced-motion: reduce){.office-svg *{animation:none!important}}`;

  return (
    <div>
      <style>{css}</style>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 ${live ? "bg-warn-bg text-warn-ink" : "bg-surface-2 text-ink-2"}`}>
          <span aria-hidden>{live ? "●" : "◐"}</span>
          {caption}
        </span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-ink-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--s-portfolio)" }} /> IA (Claude)
          </span>
          <span className="flex items-center gap-1 text-ink-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--s-cash)" }} /> Código
          </span>
          <button onClick={() => setPlaying((p) => !p)} className="rounded-md border border-line px-2 py-1 text-ink-2 hover:bg-surface-2">
            {playing ? "Pausar" : "Reproducir"}
          </button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line" style={{ background: "var(--surface-2)" }}>
        <svg viewBox="0 0 960 540" className="office-svg block w-full min-w-[640px]" role="img" aria-label="Oficina con los agentes del fondo">
          {/* suelo y paredes */}
          <rect x="0" y="0" width="960" height="540" fill="var(--surface-2)" />
          <rect x="0" y="0" width="960" height="40" fill="var(--grid)" />
          <text x="20" y="26" fontSize="14" fontWeight="600" fill="var(--ink-2)">
            Claude vs. el Mercado · Oficina del fondo
          </text>
          {/* sala de reuniones */}
          <rect x="300" y="215" width="360" height="155" rx="16" fill="var(--surface)" stroke="var(--border)" strokeDasharray="6 4" />
          <text x="314" y="234" fontSize="12" fill="var(--muted)">
            Sala de reuniones
          </text>
          <ellipse cx="480" cy="304" rx="120" ry="32" fill="#b08a62" opacity="0.85" />
          <ellipse cx="480" cy="300" rx="120" ry="32" fill="#c9a27a" />
          {/* plantas */}
          {[
            [40, 500],
            [920, 500],
            [920, 80],
          ].map(([x, y]) => (
            <g key={`${x}-${y}`} transform={`translate(${x},${y})`}>
              <rect x="-10" y="0" width="20" height="18" rx="3" fill="#a0603a" />
              <circle cx="-7" cy="-6" r="10" fill="#3f8f4f" />
              <circle cx="7" cy="-8" r="11" fill="#4ea65f" />
              <circle cx="0" cy="-16" r="9" fill="#3f8f4f" />
            </g>
          ))}
          {/* mesas */}
          {agents.map((a) => (
            <g key={`desk-${a.id}`} transform={`translate(${a.desk.x},${a.desk.y})`}>
              <rect x="-46" y="10" width="92" height="34" rx="5" fill="var(--surface)" stroke="var(--border)" />
              <rect x="-17" y="-4" width="34" height="20" rx="3" fill="var(--ink-2)" />
              <rect
                x="-14"
                y="-1"
                width="28"
                height="14"
                rx="2"
                fill={a.ai ? "var(--s-portfolio)" : "var(--s-sp500)"}
                style={{ animation: playing ? `glow ${1.6 + (a.desk.x % 7) / 10}s ease-in-out infinite` : undefined, opacity: 0.6 }}
              />
              <text y="60" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--ink)">
                {a.name}
              </text>
              <text y="74" textAnchor="middle" fontSize="10.5" fill="var(--muted)">
                {a.role}
              </text>
            </g>
          ))}
          {/* personas */}
          {agents.map((a) => (
            <a key={`p-${a.id}`} href={`#agente-${a.id}`} aria-label={a.name}>
              <g transform={`translate(${a.desk.x},${a.desk.y - SIT})`}>
                <g style={{ animation: playing && a.slot ? `walk-${a.id} ${CYCLE_S}s ease-in-out infinite` : undefined }}>
                  <g style={{ animation: playing ? `type ${0.9 + (a.desk.y % 5) / 10}s ease-in-out infinite` : undefined }}>
                    <Person hair={a.hair} ai={a.ai} />
                  </g>
                  {a.bubble && a.slot && (
                    <g style={{ animation: playing ? `say-${a.id} ${CYCLE_S}s ease-in-out infinite` : undefined, opacity: playing ? undefined : 0 }}>
                      <rect x={bubbleX(a)} y="-44" width={bubbleW(a.bubble)} height="24" rx="8" fill="var(--surface)" stroke="var(--border)" />
                      <text x={bubbleX(a) + 8} y="-28" fontSize="11" fill="var(--ink)">
                        {a.bubble}
                      </text>
                    </g>
                  )}
                </g>
              </g>
            </a>
          ))}
        </svg>
      </div>
    </div>
  );
}
