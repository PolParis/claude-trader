"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

// ---------------------------------------------------------------------------------------------
// Oficina isométrica. El plano se define en coordenadas de planta (x, y en "cm", 2400 × 1600) y se
// proyecta en isométrico: X = (x − y)·cos30°, Y = (x + y)·sin30° − z. Lo plano (suelos, nombres de
// sala) se dibuja con una matriz; lo que tiene altura (mesas, monitores, personas) se proyecta punto
// a punto y se ordena por profundidad.
// ---------------------------------------------------------------------------------------------

const C = Math.cos(Math.PI / 6);
const S = 0.5;
const P = (x: number, y: number, z = 0): [number, number] => [(x - y) * C, (x + y) * S - z];
const pts = (list: [number, number][]) => list.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ");
const ISO = `matrix(${C},${S},${-C},${S},0,0)`;

const NEON = "#c6ff00";
const WALL_H = 34;
const CORRIDOR_Y = 580;

type Pt = { x: number; y: number };
interface Room {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  door: { x: number; side: "top" | "bottom" };
  grid?: { dx: number; dy: number; top?: number }; // mesas de relleno
  floorName?: string; // nombre pintado en el suelo si es distinto (más corto)
  labelAt?: "front" | "back"; // dónde se pinta el nombre (por defecto, delante, junto a la pared sur)
}

const ROOMS: Room[] = [
  { id: "datos", name: "SALA DE DATOS", x: 0, y: 0, w: 560, h: 520, door: { x: 280, side: "bottom" }, grid: { dx: 120, dy: 100, top: 230 } },
  { id: "lab", name: "LABORATORIO QUANT", x: 580, y: 0, w: 720, h: 520, door: { x: 940, side: "bottom" }, grid: { dx: 112, dy: 92 } },
  { id: "riesgos", name: "CONTROL DE RIESGOS", x: 1320, y: 0, w: 480, h: 520, door: { x: 1560, side: "bottom" }, grid: { dx: 112, dy: 96, top: 170 } },
  { id: "despacho", name: "MESA DEL GESTOR", x: 1820, y: 0, w: 580, h: 520, door: { x: 2110, side: "bottom" } },
  { id: "trading", name: "SALA DE TRADING", x: 0, y: 640, w: 1000, h: 960, door: { x: 500, side: "top" }, grid: { dx: 112, dy: 92, top: 180 } },
  { id: "reuniones", name: "SALA DE REUNIONES", x: 1020, y: 640, w: 480, h: 460, door: { x: 1260, side: "top" }, floorName: "REUNIONES" },
  { id: "descanso", name: "DESCANSO", x: 1020, y: 1120, w: 480, h: 480, door: { x: 1260, side: "top" } },
  { id: "aula", name: "AULA", x: 1520, y: 640, w: 380, h: 460, door: { x: 1710, side: "top" }, grid: { dx: 100, dy: 84, top: 200 } },
  { id: "academia", name: "ACADEMIA", x: 1920, y: 640, w: 480, h: 460, door: { x: 2160, side: "top" }, grid: { dx: 120, dy: 100, top: 220 } },
  { id: "pruebas", name: "MESA DE PRUEBAS", x: 1520, y: 1120, w: 480, h: 480, door: { x: 1760, side: "top" }, grid: { dx: 112, dy: 92 } },
  { id: "archivo", name: "ARCHIVO Y AUDITORÍA", x: 2020, y: 1120, w: 380, h: 480, door: { x: 2210, side: "top" } },
];

/** Puesto de cada agente: mesa, sala, sitio en la reunión y segundos del ciclo en que asiste. */
const POSTS: Record<string, { room: string; desk: Pt; seat: Pt | null; slot: [number, number] | null; bubble?: number }> = {
  datos: { room: "datos", desk: { x: 280, y: 150 }, seat: { x: 1260, y: 700 }, slot: [0, 14], bubble: 1 },
  motor: { room: "lab", desk: { x: 820, y: 150 }, seat: { x: 1165, y: 705 }, slot: [3, 34], bubble: 1 },
  analista: { room: "lab", desk: { x: 1060, y: 150 }, seat: { x: 1355, y: 705 }, slot: [5, 34] },
  riesgos: { room: "riesgos", desk: { x: 1560, y: 130 }, seat: { x: 1330, y: 900 }, slot: [7, 36], bubble: 1 },
  gestor: { room: "despacho", desk: { x: 2110, y: 260 }, seat: { x: 1090, y: 800 }, slot: [1, 42] },
  ejecucion: { room: "trading", desk: { x: 500, y: 760 }, seat: { x: 1190, y: 900 }, slot: [28, 44], bubble: 1 },
  profesor: { room: "aula", desk: { x: 1710, y: 760 }, seat: { x: 1430, y: 800 }, slot: [33, 47] },
  academia: { room: "academia", desk: { x: 2160, y: 760 }, seat: null, slot: null },
  auditor: { room: "archivo", desk: { x: 2210, y: 1300 }, seat: null, slot: null },
};

const CYCLE_S = 48;
const SPEED = 420; // unidades de planta por segundo al caminar

export interface OfficeAgent {
  id: string;
  name: string;
  role: string;
  ai: boolean;
  hair: string;
  bubble: string | null;
  summary: string | null;
}

// ---------- Nombres de las salas pintados en el suelo ----------

const SOUTH_WALL_SHADOW = 80; // la pared sur tapa en pantalla la franja de suelo que tiene detrás

/** Líneas, tamaño y posición del nombre de una sala, y hasta dónde se pueden poner mesas. */
function roomLabel(r: Room) {
  const fit = (lines: string[]) => Math.min(70, (r.w - 60) / (Math.max(...lines.map((l) => l.length)) * 0.68));
  const name = r.floorName ?? r.name;
  let lines = [name];
  const words = name.split(" ");
  if (fit(lines) < 48 && words.length > 1) {
    // partir en dos líneas lo más equilibradas posible
    let best = lines;
    let bestSize = 0;
    for (let i = 1; i < words.length; i++) {
      const cand = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
      if (fit(cand) > bestSize) {
        bestSize = fit(cand);
        best = cand;
      }
    }
    lines = best;
  }
  const size = fit(lines);
  const lead = size * 1.08;
  const band = lines.length * lead;
  const firstBaseline = r.labelAt === "back" ? r.y + 30 + size : r.y + r.h - SOUTH_WALL_SHADOW - (lines.length - 1) * lead;
  const deskLimit = r.labelAt === "back" ? r.y + r.h - 60 : r.y + r.h - SOUTH_WALL_SHADOW - band - 40;
  return { lines, size, lead, firstBaseline, deskLimit };
}

// ---------- Recorridos y animación ----------

function pathFor(id: string): Pt[] | null {
  const p = POSTS[id];
  if (!p?.seat) return null;
  const room = ROOMS.find((r) => r.id === p.room)!;
  const meet = ROOMS.find((r) => r.id === "reuniones")!;
  const doorY = room.door.side === "bottom" ? room.y + room.h : room.y;
  const inside = room.door.side === "bottom" ? doorY - 50 : doorY + 50;
  return [
    p.desk,
    { x: p.desk.x, y: inside },
    { x: room.door.x, y: inside },
    { x: room.door.x, y: CORRIDOR_Y },
    { x: meet.door.x, y: CORRIDOR_Y },
    { x: meet.door.x, y: meet.y + 60 },
    p.seat,
  ];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function keyframes(id: string): string {
  const path = pathFor(id);
  const slot = POSTS[id]?.slot;
  if (!path || !slot) return "";
  const [s, e] = slot;
  const legs = path.slice(1).map((p, i) => dist(path[i], p) / SPEED);
  const travel = legs.reduce((a, b) => a + b, 0);
  const k = Math.min(1, (e - s) / (2 * travel + 2));
  const frames: [number, Pt][] = [
    [0, path[0]],
    [s, path[0]],
  ];
  let t = s;
  legs.forEach((l, i) => frames.push([(t += l * k), path[i + 1]]));
  const arrive = t;
  const leave = e - travel * k;
  t = leave;
  frames.push([t, path.at(-1)!]);
  [...legs].reverse().forEach((l, i) => frames.push([(t += l * k), path[path.length - 2 - i]]));
  frames.push([CYCLE_S, path[0]]);
  const pct = (x: number) => ((x / CYCLE_S) * 100).toFixed(2);
  const [hx, hy] = P(path[0].x, path[0].y);
  const walk = frames
    .map(([tt, p]) => {
      const [X, Y] = P(p.x, p.y);
      return `${pct(tt)}%{transform:translate(${(X - hx).toFixed(1)}px,${(Y - hy).toFixed(1)}px)}`;
    })
    .join("");
  const say = `0%,${pct(arrive)}%{opacity:0}${pct(arrive + 0.4)}%,${pct(leave - 0.4)}%{opacity:1}${pct(leave)}%,100%{opacity:0}`;
  return `@keyframes walk-${id}{${walk}}@keyframes say-${id}{${say}}`;
}

// ---------- Objetos con volumen ----------

/** Caja isométrica (mesa, armario, servidor...) con su cara superior y las dos laterales visibles. */
function IsoBox({ x, y, w, d, h, z = 0, top, left, right, stroke }: { x: number; y: number; w: number; d: number; h: number; z?: number; top: string; left: string; right: string; stroke?: string }) {
  const t = (a: number, b: number) => P(a, b, z + h);
  const g = (a: number, b: number) => P(a, b, z);
  return (
    <g>
      <polygon points={pts([g(x, y + d), g(x + w, y + d), t(x + w, y + d), t(x, y + d)])} fill={left} />
      <polygon points={pts([g(x + w, y), g(x + w, y + d), t(x + w, y + d), t(x + w, y)])} fill={right} />
      <polygon points={pts([t(x, y), t(x + w, y), t(x + w, y + d), t(x, y + d)])} fill={top} stroke={stroke} strokeWidth={stroke ? 1.5 : 0} />
    </g>
  );
}

/** Mesa de trabajo con monitor (pantalla encendida o apagada). */
function Workstation({ x, y, on, color, chart }: { x: number; y: number; on: boolean; color: string; chart: number }) {
  const [mx, my] = P(x, y - 6, 26);
  const line = ["M-12,6 L-6,1 L0,4 L6,-3 L12,-1", "M-12,0 L-6,4 L0,-2 L6,2 L12,-4", "M-12,5 L-5,3 L1,4 L6,-1 L12,-3"][chart % 3];
  return (
    <g>
      <IsoBox x={x - 34} y={y - 18} w={68} d={36} h={22} top="#4a4e57" left="#2a2d33" right="#353840" />
      <polygon points={pts([P(x - 10, y + 22, 0), P(x + 10, y + 22, 0), P(x + 10, y + 34, 0), P(x - 10, y + 34, 0)])} fill="#2a2d33" />
      <g transform={`translate(${mx.toFixed(1)},${my.toFixed(1)})`}>
        <rect x="-17" y="-16" width="34" height="22" rx="2" fill="#111317" />
        <rect x="-14" y="-13" width="28" height="16" rx="1.5" fill={on ? color : "#22252b"} className={on ? "office-glow" : undefined} />
        {on && <path d={line} transform="translate(0,-5)" stroke="#0b0c0f" strokeWidth="1.4" fill="none" opacity=".75" />}
      </g>
    </g>
  );
}

function Plant({ x, y }: { x: number; y: number }) {
  const [X, Y] = P(x, y);
  return (
    <g transform={`translate(${X.toFixed(1)},${Y.toFixed(1)})`}>
      <rect x="-8" y="-14" width="16" height="14" rx="2" fill="#2a2d33" />
      <circle cx="-6" cy="-22" r="9" fill="#2f8f44" />
      <circle cx="6" cy="-24" r="10" fill="#3fb257" />
      <circle cx="0" cy="-32" r="8" fill="#2f8f44" />
    </g>
  );
}

/** Pantalla grande colgada (gráficos, alertas o cotizaciones). */
function WallScreen({ x, y, w, kind }: { x: number; y: number; w: number; kind: "bars" | "alerts" | "ticker" | "fan" | "text"; text?: string }) {
  const [X, Y] = P(x, y, 58);
  return (
    <g transform={`translate(${X.toFixed(1)},${Y.toFixed(1)})`}>
      <rect x={-w / 2} y="-34" width={w} height="56" rx="3" fill="#0b0c0f" stroke={NEON} strokeWidth="1.5" />
      {kind === "bars" &&
        Array.from({ length: Math.floor(w / 14) - 1 }, (_, i) => {
          const h = 8 + ((i * 37) % 30);
          return <rect key={i} x={-w / 2 + 8 + i * 14} y={16 - h} width="8" height={h} fill={i % 4 === 0 ? "#ff4d4d" : NEON} opacity=".85" className={i % 5 === 0 ? "office-blink" : undefined} />;
        })}
      {kind === "ticker" &&
        Array.from({ length: Math.floor(w / 26) }, (_, i) => (
          <text key={i} x={-w / 2 + 8 + i * 26} y="0" fontSize="14" fill={i % 3 ? NEON : "#ff4d4d"}>
            {i % 3 ? "▲" : "▼"}
          </text>
        ))}
      {kind === "alerts" &&
        ["#3fb257", "#f2b705", "#ff4d4d"].map((c, i) => <rect key={c} x={-w / 2 + 10 + i * ((w - 20) / 3)} y="-24" width={(w - 30) / 3} height="36" rx="3" fill={c} opacity=".85" className={i === 2 ? "office-blink" : undefined} />)}
      {kind === "fan" && (
        <g stroke={NEON} fill="none">
          <path d={`M${-w / 2 + 10},10 C${-w / 4},6 0,-6 ${w / 2 - 10},-26`} strokeWidth="2" />
          <path d={`M${-w / 2 + 10},10 C${-w / 4},8 0,2 ${w / 2 - 10},-6`} strokeWidth="1" opacity=".5" />
          <path d={`M${-w / 2 + 10},10 C${-w / 4},12 0,14 ${w / 2 - 10},16`} strokeWidth="1" opacity=".5" />
        </g>
      )}
    </g>
  );
}

function Person({ hair, ai }: { hair: string; ai: boolean }) {
  const glow = ai ? NEON : "#7fd7ff";
  return (
    <g>
      <ellipse cx="0" cy="2" rx="16" ry="6" fill={glow} opacity=".35" className="office-glow" />
      <rect x="-9" y="-30" width="18" height="30" rx="8" fill={ai ? "#9fc800" : "#5aa9cf"} />
      <circle cx="0" cy="-38" r="9" fill="#f1c9a5" />
      <path d="M-9,-39 a9,9 0 0,1 18,0 q-4,-4 -9,-3 q-5,-1 -9,3z" fill={hair} />
    </g>
  );
}

// ---------- Paredes ----------

function walls(r: Room): ReactNode[] {
  const gap = 90;
  const segs: [Pt, Pt][] = [];
  const top: [Pt, Pt] = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }];
  const bottom: [Pt, Pt] = [{ x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h }];
  const split = ([a, b]: [Pt, Pt], dx: number): [Pt, Pt][] => [
    [a, { x: dx - gap / 2, y: a.y }],
    [{ x: dx + gap / 2, y: a.y }, b],
  ];
  segs.push(...(r.door.side === "top" ? split(top, r.door.x) : [top]));
  segs.push(...(r.door.side === "bottom" ? split(bottom, r.door.x) : [bottom]));
  segs.push([{ x: r.x, y: r.y }, { x: r.x, y: r.y + r.h }]);
  segs.push([{ x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }]);
  return segs.map(([a, b], i) => (
    <g key={`${r.id}-w${i}`}>
      <polygon points={pts([P(a.x, a.y), P(b.x, b.y), P(b.x, b.y, WALL_H), P(a.x, a.y, WALL_H)])} fill="#0d0e11" />
      <line x1={P(a.x, a.y, WALL_H)[0]} y1={P(a.x, a.y, WALL_H)[1]} x2={P(b.x, b.y, WALL_H)[0]} y2={P(b.x, b.y, WALL_H)[1]} stroke={NEON} strokeWidth="2.5" />
    </g>
  ));
}

// ---------- Escena estática (se calcula una vez) ----------

const hash = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

interface Prop {
  depth: number;
  node: ReactNode;
}

function buildProps(): Prop[] {
  const out: Prop[] = [];
  const add = (x: number, y: number, node: ReactNode) => out.push({ depth: x + y, node });
  const taken = Object.values(POSTS).map((p) => p.desk);
  let n = 0;
  for (const r of ROOMS) {
    if (!r.grid) continue;
    const limit = roomLabel(r).deskLimit; // deja libre la franja del nombre
    for (let y = r.y + (r.grid.top ?? 110); y < limit; y += r.grid.dy)
      for (let x = r.x + 80; x < r.x + r.w - 60; x += r.grid.dx) {
        if (taken.some((t) => Math.abs(t.x - x) < 90 && Math.abs(t.y - y) < 80)) continue;
        n++;
        const on = hash(n) < 0.55;
        const color = r.id === "trading" ? (hash(n + 7) < 0.25 ? "#ff4d4d" : NEON) : hash(n + 3) < 0.5 ? "#7fd7ff" : NEON;
        add(x, y, <Workstation key={`ws-${n}`} x={x} y={y} on={on} color={color} chart={n} />);
      }
  }
  // servidores en la sala de datos
  for (let i = 0; i < 4; i++) add(60 + i * 70, 40, <IsoBox key={`srv-${i}`} x={40 + i * 70} y={30} w={50} d={60} h={110} top="#1a1c21" left="#0f1013" right="#16181c" stroke={NEON} />);
  // mesa de reuniones
  add(1260, 800, <IsoBox key="mesa" x={1130} y={740} w={260} d={120} h={24} top="#6b4f3a" left="#3d2b1f" right="#4f3828" stroke={NEON} />);
  // despacho: mesa grande y sofá
  add(2300, 90, <IsoBox key="sofa" x={2240} y={60} w={120} d={60} h={26} top="#3a2a20" left="#22180f" right="#2c2016" />);
  // descanso: sofás, cafetera y mesa
  add(1120, 1300, <IsoBox key="sofa2" x={1080} y={1260} w={150} d={60} h={26} top="#2f3a52" left="#1c2333" right="#252e42" />);
  add(1340, 1360, <IsoBox key="sofa3" x={1300} y={1330} w={150} d={60} h={26} top="#2f3a52" left="#1c2333" right="#252e42" />);
  add(1430, 1170, <IsoBox key="cafe" x={1420} y={1150} w={50} d={40} h={60} top="#d0d0d0" left="#7d7f86" right="#9a9ca3" />);
  // academia y archivo
  for (let i = 0; i < 4; i++) add(1960 + i * 110, 670, <IsoBox key={`lib-${i}`} x={1950 + i * 110} y={660} w={90} d={30} h={80} top="#5a4030" left="#3b2a1f" right="#4a3426" />);
  for (let i = 0; i < 3; i++) add(2060 + i * 90, 1160, <IsoBox key={`arc-${i}`} x={2050 + i * 90} y={1150} w={70} d={45} h={70} top="#8b9098" left="#5b5f6a" right="#6f737d" />);
  add(2360, 1290, <IsoBox key="safe" x={2320} y={1260} w={60} d={60} h={60} top="#3a3d44" left="#1f2126" right="#2a2d33" stroke={NEON} />);
  // aula: pizarra
  add(1600, 660, <IsoBox key="pizarra" x={1560} y={650} w={300} d={14} h={80} top="#20402c" left="#1b3524" right="#183020" />);
  // plantas
  [
    [530, 490],
    [600, 490],
    [1780, 490],
    [30, 1570],
    [970, 1570],
    [1040, 1140],
    [2380, 30],
  ].forEach(([x, y], i) => add(x, y, <Plant key={`pl-${i}`} x={x} y={y} />));
  // pantallas de pared
  add(500, 642, <WallScreen key="sc-trading" x={500} y={650} w={300} kind="ticker" />);
  add(300, 690, <WallScreen key="sc-trading2" x={250} y={700} w={180} kind="bars" />);
  add(940, 2, <WallScreen key="sc-lab" x={940} y={10} w={200} kind="fan" />);
  add(1560, 2, <WallScreen key="sc-risk" x={1560} y={10} w={200} kind="alerts" />);
  return out.sort((a, b) => a.depth - b.depth);
}

// ---------- Vista con zoom y desplazamiento ----------

type View = { x: number; y: number; w: number; h: number };
const FULL: View = { x: -1440, y: -140, w: 3580, h: 2160 };
const RATIO = FULL.w / FULL.h;

function clamp(v: View): View {
  const w = Math.min(FULL.w, Math.max(520, v.w));
  const h = w / RATIO;
  return { w, h, x: Math.min(FULL.x + FULL.w - w, Math.max(FULL.x, v.x)), y: Math.min(FULL.y + FULL.h - h, Math.max(FULL.y, v.y)) };
}

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
  const props = useMemo(() => buildProps(), []);

  const toWorld = useCallback((clientX: number, clientY: number, v: View) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: v.x + ((clientX - r.left) / r.width) * v.w, y: v.y + ((clientY - r.top) / r.height) * v.h };
  }, []);

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
    const corners = [P(r.x, r.y), P(r.x + r.w, r.y), P(r.x, r.y + r.h), P(r.x + r.w, r.y + r.h)];
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const w = Math.max(Math.max(...xs) - Math.min(...xs) + 160, (Math.max(...ys) - Math.min(...ys) + 200) * RATIO);
    const h = w / RATIO;
    setView(clamp({ w, h, x: (Math.max(...xs) + Math.min(...xs)) / 2 - w / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 - h / 2 - 30 }));
  };

  const css =
    agents.map((a) => keyframes(a.id)).join("") +
    "@keyframes office-type{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}" +
    "@keyframes office-glow{0%,100%{opacity:.6}50%{opacity:1}}.office-glow{animation:office-glow 2.4s ease-in-out infinite}" +
    "@keyframes office-blink{0%,100%{opacity:1}50%{opacity:.3}}.office-blink{animation:office-blink 1.4s steps(2) infinite}" +
    ".office-paused *{animation-play-state:paused!important}" +
    "@media (prefers-reduced-motion: reduce){.office-svg *{animation:none!important}}";

  const sel = agents.find((a) => a.id === selected) ?? null;
  const selRoom = sel ? ROOMS.find((r) => r.id === POSTS[sel.id]?.room) : null;
  const floor = (x: number, y: number, w: number, h: number) => pts([P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)]);

  return (
    <div>
      <style>{css}</style>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 ${live ? "bg-warn-bg text-warn-ink" : "bg-surface-2 text-ink-2"}`}>
          <span aria-hidden>{live ? "●" : "◐"}</span>
          {caption}
        </span>
        <span className="ml-auto flex items-center gap-1 text-ink-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#9fc800" }} /> IA (Claude)
        </span>
        <span className="flex items-center gap-1 text-ink-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#5aa9cf" }} /> Código
        </span>
      </div>
      <div className="mb-2 flex flex-wrap gap-1 text-xs">
        <span className="py-1 pr-1 text-muted">Ir a:</span>
        {ROOMS.map((r) => (
          <button key={r.id} onClick={() => focusRoom(r.id)} className="rounded-md border border-line px-2 py-1 capitalize text-ink-2 hover:bg-surface-2">
            {r.name.toLowerCase()}
          </button>
        ))}
      </div>
      <div className="relative overflow-hidden rounded-lg border border-line" style={{ background: "#0f1115" }}>
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          className={`office-svg block w-full select-none ${playing ? "" : "office-paused"} ${grabbing ? "cursor-grabbing" : "cursor-grab"}`}
          style={{ aspectRatio: `${RATIO}`, touchAction: "none" }}
          role="img"
          aria-label="Oficina isométrica con los agentes del fondo"
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
            if (d && !d.moved) setSelected((e.target as Element).closest("[data-agent]")?.getAttribute("data-agent") ?? null);
          }}
          onPointerLeave={() => {
            drag.current = null;
            setGrabbing(false);
          }}
          onDoubleClick={(e) =>
            setView((v) => {
              const p = toWorld(e.clientX, e.clientY, v);
              return zoomView(v, 0.6, p.x, p.y);
            })
          }
        >
          <rect x={FULL.x} y={FULL.y} width={FULL.w} height={FULL.h} fill="#0f1115" />
          {/* base del edificio y pasillo */}
          <polygon points={floor(-20, -20, 2440, 1640)} fill="#16181d" stroke={NEON} strokeWidth="3" />
          <polygon points={floor(0, 530, 2400, 100)} fill="#c9c9c2" />

          {/* suelos y nombres pintados en el suelo */}
          {ROOMS.map((r) => (
            <polygon key={`f-${r.id}`} points={floor(r.x, r.y, r.w, r.h)} fill={r.id === "reuniones" || r.id === "descanso" ? "#dcd6cb" : "#e4e4df"} />
          ))}
          <g transform={ISO}>
            {ROOMS.map((r) => {
              const l = roomLabel(r);
              return (
                <text key={`t-${r.id}`} fontSize={l.size} fontWeight="900" fill="rgba(20,22,26,.34)" letterSpacing="1">
                  {l.lines.map((line, i) => (
                    <tspan key={i} x={r.x + 30} y={l.firstBaseline + i * l.lead}>
                      {line}
                    </tspan>
                  ))}
                </text>
              );
            })}
            <text x={1620} y={CORRIDOR_Y + 14} fontSize="34" fontWeight="800" fill="rgba(20,22,26,.3)">
              PASILLO
            </text>
            {/* líneas de neón en el suelo del pasillo */}
            {Array.from({ length: 22 }, (_, i) => (
              <rect key={i} x={40 + i * 108} y={CORRIDOR_Y - 3} width="54" height="6" rx="3" fill={NEON} opacity=".55" />
            ))}
          </g>

          {/* paredes del fondo (norte y oeste) antes que los objetos */}
          {ROOMS.flatMap((r) => walls(r))}

          {/* mobiliario ordenado por profundidad */}
          {props.map((p) => p.node)}

          {/* mesas de los agentes */}
          {agents.map((a, i) => {
            const p = POSTS[a.id];
            return p ? <Workstation key={`d-${a.id}`} x={p.desk.x} y={p.desk.y} on color={a.ai ? NEON : "#7fd7ff"} chart={i} /> : null;
          })}

          {/* personas */}
          {agents.map((a) => {
            const p = POSTS[a.id];
            if (!p) return null;
            const [X, Y] = P(p.desk.x - 6, p.desk.y - 40);
            const by = -96 - (p.bubble ?? 0) * 50; // alturas distintas para que no se pisen en la reunión
            const bw = a.bubble ? Math.min(330, 26 + a.bubble.length * 8.4) : 0;
            return (
              <g key={`p-${a.id}`}>
                <g transform={`translate(${X.toFixed(1)},${Y.toFixed(1)})`} data-agent={a.id} style={{ cursor: "pointer" }}>
                  <g style={{ animation: p.slot ? `walk-${a.id} ${CYCLE_S}s linear infinite` : undefined }}>
                    <rect x="-24" y="-56" width="48" height="66" fill="transparent" />
                    <g style={{ animation: `office-type ${0.9 + (p.desk.x % 5) / 10}s ease-in-out infinite` }}>
                      <Person hair={a.hair} ai={a.ai} />
                    </g>
                    {selected === a.id && <ellipse cx="0" cy="2" rx="30" ry="12" fill="none" stroke="#fff" strokeWidth="3" strokeDasharray="6 4" />}
                    {a.bubble && p.slot && (
                      <g style={{ animation: `say-${a.id} ${CYCLE_S}s linear infinite`, opacity: 0 }}>
                        <line x1="0" y1="-50" x2="0" y2={by + 34} stroke={NEON} strokeWidth="1.2" />
                        <rect x={-bw / 2} y={by} width={bw} height="34" rx="6" fill="#0b0c0f" stroke={NEON} strokeWidth="1.5" />
                        <text x={-bw / 2 + 13} y={by + 23} fontSize="16" fill="#f3f3f3">
                          {a.bubble}
                        </text>
                      </g>
                    )}
                  </g>
                </g>
              </g>
            );
          })}

          {/* placas con el nombre de cada agente junto a su mesa */}
          {agents.map((a) => {
            const p = POSTS[a.id];
            if (!p) return null;
            const [X, Y] = P(p.desk.x + 40, p.desk.y + 40);
            const w = 20 + a.name.length * 8.6;
            return (
              <g key={`l-${a.id}`} transform={`translate(${X.toFixed(1)},${Y.toFixed(1)})`} pointerEvents="none">
                <rect x={-w / 2} y="-2" width={w} height="26" rx="13" fill="rgba(11,12,15,.85)" stroke={a.ai ? NEON : "#7fd7ff"} strokeWidth="1.2" />
                <text y="16" textAnchor="middle" fontSize="15" fontWeight="600" fill="#f3f3f3">
                  {a.name}
                </text>
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
            <button key={title} onClick={fn} title={title} aria-label={title} className="h-8 w-8 rounded-md border border-[#c6ff00]/50 bg-[#0b0c0f] text-sm text-white shadow-sm hover:bg-[#1c1f25]">
              {label}
            </button>
          ))}
        </div>

        {/* ficha del agente seleccionado */}
        {sel && (
          <div className="absolute bottom-2 left-2 right-2 rounded-lg border border-[#c6ff00]/60 bg-[#0b0c0f]/95 p-3 text-xs text-[#e8e8e8] shadow-md sm:right-auto sm:max-w-sm">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: sel.ai ? "#9fc800" : "#5aa9cf" }} />
              <strong className="text-sm text-white">{sel.name}</strong>
              <span className="text-[#a8a8a8]">· {sel.role}</span>
              <button onClick={() => setSelected(null)} className="ml-auto px-1 text-[#a8a8a8] hover:text-white" aria-label="Cerrar">
                ✕
              </button>
            </div>
            {selRoom && <p className="mt-1 capitalize text-[#a8a8a8]">{selRoom.name.toLowerCase()}</p>}
            <p className="mt-2">{sel.summary ?? "Todavía no ha trabajado."}</p>
            <a href={`#agente-${sel.id}`} className="mt-2 inline-block text-[#c6ff00]">
              Ver su ficha completa ↓
            </a>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">Arrastra para moverte · rueda del ratón o doble clic para hacer zoom · pulsa en un agente para ver qué ha hecho.</p>
    </div>
  );
}
