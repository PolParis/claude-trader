"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

// ---------------------------------------------------------------------------------------------
// Plano de la oficina (coordenadas del "mundo": 1600 × 1000). Cada agente trabaja en su sala y,
// en la reunión, sale por la puerta, recorre el pasillo y se sienta en la sala de reuniones.
// ---------------------------------------------------------------------------------------------

type Pt = { x: number; y: number };
interface Room {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  floor: string;
  doors: { x: number; y: number; vertical?: boolean }[];
}

const W = 1600;
const H = 1000;
const CORRIDOR_Y = 490;
const WALL = "#5b5f6a";

const ROOMS: Room[] = [
  { id: "datos", name: "Sala de datos", x: 40, y: 40, w: 360, h: 400, floor: "#e7eef5", doors: [{ x: 220, y: 440 }] },
  { id: "lab", name: "Laboratorio cuantitativo", x: 420, y: 40, w: 480, h: 400, floor: "#e9f1ea", doors: [{ x: 660, y: 440 }] },
  { id: "riesgos", name: "Control de riesgos", x: 920, y: 40, w: 320, h: 400, floor: "#f5eaea", doors: [{ x: 1080, y: 440 }] },
  { id: "despacho", name: "Despacho del gestor", x: 1260, y: 40, w: 300, h: 400, floor: "#efe6da", doors: [{ x: 1410, y: 440 }] },
  { id: "trading", name: "Mesa de operaciones", x: 40, y: 540, w: 420, h: 420, floor: "#e6e8f2", doors: [{ x: 250, y: 540 }] },
  { id: "reuniones", name: "Sala de reuniones", x: 480, y: 540, w: 480, h: 420, floor: "#f1e9dc", doors: [{ x: 720, y: 540 }] },
  { id: "aula", name: "Aula", x: 980, y: 540, w: 260, h: 420, floor: "#eef0e4", doors: [{ x: 1110, y: 540 }] },
  { id: "academia", name: "Academia", x: 1260, y: 540, w: 300, h: 220, floor: "#f2e8ef", doors: [{ x: 1410, y: 540 }] },
  { id: "archivo", name: "Archivo y auditoría", x: 1260, y: 760, w: 300, h: 200, floor: "#e9e9e9", doors: [{ x: 1260, y: 860, vertical: true }] },
];

/** Puesto de cada agente: su mesa, su sala y su sitio en la mesa de reuniones (segundos del ciclo). */
const POSTS: Record<string, { room: string; desk: Pt; seat: Pt | null; slot: [number, number] | null }> = {
  datos: { room: "datos", desk: { x: 220, y: 250 }, seat: { x: 720, y: 690 }, slot: [0, 13] },
  motor: { room: "lab", desk: { x: 540, y: 200 }, seat: { x: 640, y: 700 }, slot: [3, 33] },
  analista: { room: "lab", desk: { x: 780, y: 200 }, seat: { x: 800, y: 700 }, slot: [5, 33] },
  riesgos: { room: "riesgos", desk: { x: 1080, y: 250 }, seat: { x: 880, y: 775 }, slot: [7, 35] },
  gestor: { room: "despacho", desk: { x: 1410, y: 250 }, seat: { x: 560, y: 775 }, slot: [1, 41] },
  ejecucion: { room: "trading", desk: { x: 150, y: 700 }, seat: { x: 650, y: 855 }, slot: [27, 43] },
  profesor: { room: "aula", desk: { x: 1110, y: 700 }, seat: { x: 790, y: 855 }, slot: [33, 47] },
  academia: { room: "academia", desk: { x: 1410, y: 680 }, seat: null, slot: null },
  auditor: { room: "archivo", desk: { x: 1410, y: 880 }, seat: null, slot: null },
};

const CYCLE_S = 48;
const SPEED = 300; // unidades del mundo por segundo al caminar
const SIT = 34; // la persona se dibuja por encima de su mesa

export interface OfficeAgent {
  id: string;
  name: string;
  role: string;
  ai: boolean;
  hair: string;
  bubble: string | null;
  summary: string | null;
}

function pathFor(id: string): Pt[] | null {
  const p = POSTS[id];
  if (!p?.seat) return null;
  const room = ROOMS.find((r) => r.id === p.room)!;
  const door = room.doors[0];
  const meet = ROOMS.find((r) => r.id === "reuniones")!.doors[0];
  const home = { x: p.desk.x, y: p.desk.y - SIT };
  // salir de la sala, ir por el pasillo hasta la puerta de la sala de reuniones y sentarse
  return [
    home,
    { x: door.x, y: home.y < door.y ? door.y - 30 : door.y + 30 },
    { x: door.x, y: CORRIDOR_Y },
    { x: meet.x, y: CORRIDOR_Y },
    { x: meet.x, y: meet.y + 40 },
    p.seat,
  ];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Keyframes con varias paradas: ida por el pasillo, reunión y vuelta por el mismo camino. */
function keyframes(id: string): string {
  const pts = pathFor(id);
  const slot = POSTS[id]?.slot;
  if (!pts || !slot) return "";
  const [s, e] = slot;
  const legs = pts.slice(1).map((p, i) => dist(pts[i], p) / SPEED);
  const travel = legs.reduce((a, b) => a + b, 0);
  const k = Math.min(1, (e - s) / (2 * travel + 2)); // si no da tiempo, camina más rápido
  const home = pts[0];
  const frames: [number, Pt][] = [
    [0, home],
    [s, home],
  ];
  let t = s;
  legs.forEach((l, i) => frames.push([(t += l * k), pts[i + 1]]));
  const arrive = t;
  const leave = e - travel * k;
  t = leave;
  frames.push([t, pts.at(-1)!]);
  [...legs].reverse().forEach((l, i) => frames.push([(t += l * k), pts[pts.length - 2 - i]]));
  frames.push([CYCLE_S, home]);
  const pct = (x: number) => ((x / CYCLE_S) * 100).toFixed(2);
  const walk = frames.map(([tt, p]) => `${pct(tt)}%{transform:translate(${p.x - home.x}px,${p.y - home.y}px)}`).join("");
  const say = `0%,${pct(arrive)}%{opacity:0}${pct(arrive + 0.4)}%,${pct(leave - 0.4)}%{opacity:1}${pct(leave)}%,100%{opacity:0}`;
  return `@keyframes walk-${id}{${walk}}@keyframes say-${id}{${say}}`;
}

// ---------------------------------------------------------------------------------------------
// Dibujos
// ---------------------------------------------------------------------------------------------

function Person({ hair, ai }: { hair: string; ai: boolean }) {
  return (
    <g>
      <ellipse cx="0" cy="17" rx="13" ry="3" fill="rgba(0,0,0,.15)" />
      <rect x="-11" y="-2" width="22" height="18" rx="8" fill={ai ? "#2a78d6" : "#7d7f86"} />
      <circle cx="0" cy="-10" r="9" fill="#f1c9a5" />
      <path d="M-9,-11 a9,9 0 0,1 18,0 q-4,-4 -9,-3 q-5,-1 -9,3z" fill={hair} />
      <circle cx="-3" cy="-9" r="1.1" fill="#3b2a20" />
      <circle cx="3" cy="-9" r="1.1" fill="#3b2a20" />
    </g>
  );
}

function Desk({ x, y, on, color = "#2a78d6", chart = 0 }: { x: number; y: number; on: boolean; color?: string; chart?: number }) {
  const line = ["M-11,8 L-5,3 L0,6 L6,-1 L11,1", "M-11,2 L-5,6 L0,0 L6,4 L11,-2", "M-11,7 L-4,5 L2,6 L7,1 L11,-1"][chart % 3];
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x="-14" y="44" width="28" height="12" rx="5" fill="#4a4d55" opacity=".7" />
      <rect x="-48" y="10" width="96" height="36" rx="5" fill="#fbfaf7" stroke="#c9c6bd" />
      <rect x="-18" y="-6" width="36" height="22" rx="3" fill="#33363d" />
      <rect x="-15" y="-3" width="30" height="16" rx="2" fill={on ? color : "#55585f"} className={on ? "office-glow" : undefined} />
      {on && <path d={line} transform="translate(0,5)" stroke="#fff" strokeWidth="1.3" fill="none" opacity=".9" />}
      <rect x="-12" y="24" width="24" height="7" rx="2" fill="#d9d6cd" />
      <circle cx="28" cy="24" r="5" fill="#fff" stroke="#c9c6bd" />
    </g>
  );
}

function Plant({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <rect x="-10" y="0" width="20" height="18" rx="3" fill="#a0603a" />
      <circle cx="-7" cy="-6" r="10" fill="#3f8f4f" />
      <circle cx="7" cy="-8" r="11" fill="#4ea65f" />
      <circle cx="0" cy="-16" r="9" fill="#3f8f4f" />
    </g>
  );
}

function Shelf({ x, y, w = 120 }: { x: number; y: number; w?: number }) {
  const cols = ["#c0392b", "#2a78d6", "#e3a008", "#1baf7a", "#8e44ad", "#d35400"];
  return (
    <g transform={`translate(${x},${y})`}>
      <rect width={w} height="26" rx="2" fill="#8a6a4a" />
      {Array.from({ length: Math.floor((w - 8) / 9) }, (_, i) => (
        <rect key={i} x={4 + i * 9} y={4 + (i % 3)} width="7" height={18 - (i % 3)} fill={cols[i % cols.length]} />
      ))}
    </g>
  );
}

function Server({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect width="44" height="80" rx="4" fill="#2f3238" />
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <rect x="6" y={8 + i * 14} width="32" height="8" rx="1.5" fill="#44474f" />
          <circle cx="33" cy={12 + i * 14} r="1.8" fill={i % 2 ? "#1baf7a" : "#eda100"} className="office-blink" style={{ animationDelay: `${i * 0.3}s` }} />
        </g>
      ))}
    </g>
  );
}

function Board({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children?: ReactNode }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect width={w} height={h} rx="3" fill="#fff" stroke="#9aa0a6" strokeWidth="3" />
      {children}
    </g>
  );
}

function Furniture() {
  return (
    <g>
      {/* Sala de datos */}
      <Server x={70} y={80} />
      <Server x={124} y={80} />
      <Server x={178} y={80} />
      <Desk x={300} y={360} on={false} />
      <Plant x={370} y={410} />
      {/* Laboratorio cuantitativo */}
      <Board x={720} y={66} w={140} h={70}>
        <path d="M10,55 C40,50 60,30 130,12" stroke="#2a78d6" strokeWidth="2" fill="none" />
        <path d="M10,55 C40,52 70,45 130,40" stroke="#2a78d6" strokeWidth="1" fill="none" opacity=".5" />
        <path d="M10,55 C40,56 70,60 130,64" stroke="#2a78d6" strokeWidth="1" fill="none" opacity=".5" />
        <text x="10" y="16" fontSize="10" fill="#555">
          Monte Carlo
        </text>
      </Board>
      <Desk x={540} y={330} on={false} />
      <Desk x={780} y={330} on={false} />
      <Plant x={450} y={410} />
      {/* Control de riesgos */}
      <Board x={950} y={84} w={260} h={60}>
        <rect x="12" y="14" width="60" height="32" rx="3" fill="#1baf7a" opacity=".8" />
        <rect x="80" y="14" width="60" height="32" rx="3" fill="#eda100" opacity=".8" />
        <rect x="148" y="14" width="60" height="32" rx="3" fill="#c22f2f" opacity=".8" className="office-blink" />
        <text x="216" y="35" fontSize="11" fill="#555">
          VaR
        </text>
      </Board>
      <Desk x={1080} y={360} on={false} />
      <Plant x={1210} y={410} />
      {/* Despacho del gestor */}
      <rect x="1300" y="46" width="220" height="10" fill="#9fd0f0" />
      <Shelf x={1290} y={380} w={110} />
      <rect x="1440" y="350" width="90" height="56" rx="12" fill="#6b4f3a" />
      <rect x="1446" y="356" width="78" height="20" rx="8" fill="#80604a" />
      <Plant x={1530} y={120} s={1.2} />
      {/* Pasillo: rincón del café */}
      <rect x="1440" y="458" width="60" height="26" rx="3" fill="#6b6f78" />
      <rect x="1452" y="452" width="16" height="14" rx="2" fill="#2f3238" />
      <circle cx="1484" cy="466" r="5" fill="#fff" />
      <text x="1435" y="512" fontSize="11" fill="#777">
        café
      </text>
      <Plant x={30} y={505} s={0.9} />
      {/* Mesa de operaciones */}
      <Board x={70} y={575} w={360} h={44}>
        {Array.from({ length: 12 }, (_, i) => (
          <text key={i} x={8 + i * 29} y="27" fontSize="10" fill={i % 3 ? "#1b8a5a" : "#c22f2f"}>
            {i % 3 ? "▲" : "▼"}
          </text>
        ))}
      </Board>
      <Desk x={330} y={700} on chart={1} color="#1b8a5a" />
      <Desk x={150} y={850} on={false} />
      <Desk x={330} y={850} on chart={2} color="#1b8a5a" />
      {/* Sala de reuniones */}
      <ellipse cx="720" cy="790" rx="165" ry="62" fill="#9c7650" />
      <ellipse cx="720" cy="784" rx="165" ry="62" fill="#c9a27a" />
      <Board x={600} y={575} w={240} h={50}>
        <text x="12" y="30" fontSize="12" fill="#555">
          Orden del día: datos → riesgo → decisión
        </text>
      </Board>
      <Plant x={510} y={930} />
      <Plant x={930} y={930} />
      {/* Aula */}
      <rect x="1010" y="575" width="200" height="40" rx="3" fill="#2f4f3a" stroke="#8a6a4a" strokeWidth="4" />
      <text x="1022" y="600" fontSize="12" fill="#e8f0e8">
        PER = precio / beneficio
      </text>
      {[0, 1, 2].map((r) =>
        [0, 1].map((c) => <rect key={`${r}-${c}`} x={1030 + c * 100} y={800 + r * 52} width="60" height="22" rx="4" fill="#fbfaf7" stroke="#c9c6bd" />),
      )}
      {/* Academia */}
      <Shelf x={1280} y={580} w={120} />
      <Shelf x={1420} y={580} w={120} />
      {/* Archivo */}
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${1290 + i * 40},${800})`}>
          <rect width="34" height="50" rx="2" fill="#8b9098" />
          <rect x="6" y="8" width="22" height="4" rx="1" fill="#5b5f6a" />
          <rect x="6" y="28" width="22" height="4" rx="1" fill="#5b5f6a" />
        </g>
      ))}
      <rect x="1500" y="900" width="44" height="44" rx="4" fill="#4a4d55" />
      <circle cx="1522" cy="922" r="9" fill="none" stroke="#c9c6bd" strokeWidth="3" />
    </g>
  );
}

// ---------------------------------------------------------------------------------------------
// Componente con zoom y desplazamiento
// ---------------------------------------------------------------------------------------------

type View = { x: number; y: number; w: number; h: number };
const FULL: View = { x: 0, y: 0, w: W, h: H };

function clamp(v: View): View {
  const w = Math.min(W, Math.max(260, v.w));
  const h = (w * H) / W;
  return { w, h, x: Math.min(W - w, Math.max(0, v.x)), y: Math.min(H - h, Math.max(0, v.y)) };
}

/** Zoom manteniendo fijo el punto (px, py) del mundo. */
function zoomView(v: View, factor: number, px = v.x + v.w / 2, py = v.y + v.h / 2): View {
  const w = v.w * factor;
  const h = v.h * factor;
  return clamp({ w, h, x: px - ((px - v.x) / v.w) * w, y: py - ((py - v.y) / v.h) * h });
}

export function Office({ agents, live, caption }: { agents: OfficeAgent[]; live: boolean; caption: string }) {
  const [playing, setPlaying] = useState(true);
  const [view, setView] = useState<View>(FULL);
  const [selected, setSelected] = useState<string | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);

  const toWorld = useCallback((clientX: number, clientY: number, v: View) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: v.x + ((clientX - r.left) / r.width) * v.w, y: v.y + ((clientY - r.top) / r.height) * v.h };
  }, []);

  // Rueda del ratón = zoom (listener no pasivo para que la página no haga scroll).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => {
        const p = toWorld(e.clientX, e.clientY, v);
        return zoomView(v, Math.exp(e.deltaY * 0.0015), p.x, p.y);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [toWorld]);

  const focusRoom = (id: string) => {
    const r = ROOMS.find((x) => x.id === id)!;
    const w = Math.max(r.w + 80, ((r.h + 80) * W) / H);
    const h = (w * H) / W;
    setView(clamp({ w, h, x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2 }));
  };

  const css =
    agents.map((a) => keyframes(a.id)).join("") +
    "@keyframes office-type{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}" +
    "@keyframes office-glow{0%,100%{opacity:.6}50%{opacity:1}}.office-glow{animation:office-glow 2.2s ease-in-out infinite}" +
    "@keyframes office-blink{0%,100%{opacity:1}50%{opacity:.25}}.office-blink{animation:office-blink 1.4s steps(2) infinite}" +
    ".office-paused *{animation-play-state:paused!important}" +
    "@media (prefers-reduced-motion: reduce){.office-svg *{animation:none!important}}";

  const sel = agents.find((a) => a.id === selected) ?? null;
  const selRoom = sel ? ROOMS.find((r) => r.id === POSTS[sel.id]?.room) : null;

  return (
    <div>
      <style>{css}</style>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 ${live ? "bg-warn-bg text-warn-ink" : "bg-surface-2 text-ink-2"}`}>
          <span aria-hidden>{live ? "●" : "◐"}</span>
          {caption}
        </span>
        <span className="ml-auto flex items-center gap-1 text-ink-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#2a78d6" }} /> IA (Claude)
        </span>
        <span className="flex items-center gap-1 text-ink-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#7d7f86" }} /> Código
        </span>
      </div>
      <div className="mb-2 flex flex-wrap gap-1 text-xs">
        <span className="py-1 pr-1 text-muted">Ir a:</span>
        {ROOMS.map((r) => (
          <button key={r.id} onClick={() => focusRoom(r.id)} className="rounded-md border border-line px-2 py-1 text-ink-2 hover:bg-surface-2">
            {r.name}
          </button>
        ))}
      </div>
      <div className="relative overflow-hidden rounded-lg border border-line" style={{ background: "#d8d5cc" }}>
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          className={`office-svg block w-full select-none ${playing ? "" : "office-paused"} ${grabbing ? "cursor-grabbing" : "cursor-grab"}`}
          style={{ aspectRatio: `${W} / ${H}`, touchAction: "none" }}
          role="img"
          aria-label="Plano de la oficina con los agentes del fondo"
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, y: e.clientY, view, moved: false };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            if (!d.moved && Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) {
              d.moved = true;
              setGrabbing(true);
              svgRef.current?.setPointerCapture(e.pointerId);
            }
            if (!d.moved) return;
            const r = svgRef.current!.getBoundingClientRect();
            setView(clamp({ ...d.view, x: d.view.x - ((e.clientX - d.x) / r.width) * d.view.w, y: d.view.y - ((e.clientY - d.y) / r.height) * d.view.h }));
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            setGrabbing(false);
            if (d && !d.moved) {
              // clic sin arrastrar: ¿sobre un agente?
              const agent = (e.target as Element).closest("[data-agent]")?.getAttribute("data-agent");
              setSelected(agent ?? null);
            }
          }}
          onPointerLeave={() => {
            drag.current = null;
            setGrabbing(false);
          }}
          onDoubleClick={(e) => setView((v) => zoomView(v, 0.6, toWorld(e.clientX, e.clientY, v).x, toWorld(e.clientX, e.clientY, v).y))}
        >
          {/* pasillo */}
          <rect x="0" y="0" width={W} height={H} fill="#d8d5cc" />
          <rect x="20" y={CORRIDOR_Y - 50} width={W - 40} height="100" fill="#cfcabe" />
          {Array.from({ length: 30 }, (_, i) => (
            <rect key={i} x={40 + i * 52} y={CORRIDOR_Y - 2} width="26" height="4" rx="2" fill="#bdb7a8" />
          ))}
          <text x="60" y={CORRIDOR_Y + 30} fontSize="13" fill="#8a8476">
            Pasillo
          </text>

          {/* salas */}
          {ROOMS.map((r) => (
            <g key={r.id}>
              <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={r.floor} stroke={WALL} strokeWidth="6" />
              {r.doors.map((d, i) =>
                d.vertical ? (
                  <rect key={i} x={d.x - 4} y={d.y - 32} width="8" height="64" fill={r.floor} />
                ) : (
                  <rect key={i} x={d.x - 32} y={d.y - 4} width="64" height="8" fill={r.floor} />
                ),
              )}
              <text x={r.x + 14} y={r.y + 26} fontSize="15" fontWeight="700" fill="#3c3f46">
                {r.name}
              </text>
            </g>
          ))}

          <Furniture />

          {/* mesas de los agentes y sus nombres */}
          {agents.map((a, i) => {
            const p = POSTS[a.id];
            return p ? <Desk key={`d-${a.id}`} x={p.desk.x} y={p.desk.y} on color={a.ai ? "#2a78d6" : "#1b8a5a"} chart={i} /> : null;
          })}
          {agents.map((a) => {
            const p = POSTS[a.id];
            return p ? (
              <text key={`n-${a.id}`} x={p.desk.x} y={p.desk.y + 74} textAnchor="middle" fontSize="13" fontWeight="600" fill="#2b2d33">
                {a.name}
              </text>
            ) : null;
          })}

          {/* personas */}
          {agents.map((a) => {
            const p = POSTS[a.id];
            if (!p) return null;
            const right = !p.seat || p.seat.x >= 720;
            const bw = a.bubble ? Math.min(280, 20 + a.bubble.length * 6.4) : 0;
            return (
              <g key={`p-${a.id}`} transform={`translate(${p.desk.x},${p.desk.y - SIT})`} data-agent={a.id} style={{ cursor: "pointer" }}>
                <g style={{ animation: p.slot ? `walk-${a.id} ${CYCLE_S}s linear infinite` : undefined }}>
                  <rect x="-22" y="-24" width="44" height="46" fill="transparent" />
                  <g style={{ animation: `office-type ${0.9 + (p.desk.x % 5) / 10}s ease-in-out infinite` }}>
                    <Person hair={a.hair} ai={a.ai} />
                  </g>
                  {selected === a.id && <circle cx="0" cy="0" r="26" fill="none" stroke="#2a78d6" strokeWidth="3" strokeDasharray="5 4" />}
                  {a.bubble && p.slot && (
                    <g style={{ animation: `say-${a.id} ${CYCLE_S}s linear infinite`, opacity: 0 }}>
                      <rect x={right ? 16 : -bw - 16} y="-50" width={bw} height="28" rx="9" fill="#fff" stroke="#b9b5aa" />
                      <text x={right ? 27 : -bw - 5} y="-31" fontSize="13" fill="#222">
                        {a.bubble}
                      </text>
                    </g>
                  )}
                </g>
              </g>
            );
          })}
        </svg>

        {/* controles */}
        <div className="absolute right-2 top-2 flex flex-col gap-1">
          {(
            [
              ["+", () => setView((v) => zoomView(v, 0.75)), "Acercar"],
              ["−", () => setView((v) => zoomView(v, 1.33)), "Alejar"],
              ["⤢", () => setView(FULL), "Ver toda la oficina"],
              [playing ? "❚❚" : "▶", () => setPlaying((x) => !x), playing ? "Pausar" : "Reproducir"],
            ] as [string, () => void, string][]
          ).map(([label, fn, title]) => (
            <button
              key={title}
              onClick={fn}
              title={title}
              aria-label={title}
              className="h-8 w-8 rounded-md border border-line bg-surface text-sm text-ink shadow-sm hover:bg-surface-2"
            >
              {label}
            </button>
          ))}
        </div>

        {/* ficha del agente seleccionado */}
        {sel && (
          <div className="absolute bottom-2 left-2 right-2 rounded-lg border border-line bg-surface p-3 text-xs shadow-md sm:right-auto sm:max-w-sm">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: sel.ai ? "#2a78d6" : "#7d7f86" }} />
              <strong className="text-sm text-ink">{sel.name}</strong>
              <span className="text-muted">· {sel.role}</span>
              <button onClick={() => setSelected(null)} className="ml-auto px-1 text-muted hover:text-ink" aria-label="Cerrar">
                ✕
              </button>
            </div>
            {selRoom && <p className="mt-1 text-muted">{selRoom.name}</p>}
            <p className="mt-2 text-ink-2">{sel.summary ?? "Todavía no ha trabajado."}</p>
            <a href={`#agente-${sel.id}`} className="mt-2 inline-block text-accent">
              Ver su ficha completa ↓
            </a>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">Arrastra para moverte · rueda del ratón o doble clic para hacer zoom · pulsa en un agente para ver qué ha hecho.</p>
    </div>
  );
}
