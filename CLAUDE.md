@AGENTS.md

# Claude vs. el Mercado — simulador de inversión con dinero ficticio

Experimento: Claude gestiona una cartera de **10.000 € FICTICIOS** sobre precios reales del mercado.
Paper trading puro: **ningún bróker ni dinero real**. No es consejo financiero; el autor no replica las decisiones.

El usuario es estudiante de ingeniería y empieza de cero: explicar cada paso brevemente, dar comandos
listos para copiar en un solo bloque (PowerShell) y guías paso a paso para Supabase/Vercel/GitHub.
Se trabaja desde 2 PCs → este archivo es la fuente de verdad del estado del proyecto. Idioma: español.

## Reglas no negociables
- Coste 0 €: prohibida la API de Anthropic y cualquier servicio de pago. Solo Vercel Hobby, Supabase Free,
  GitHub (repo público, Actions) y datos gratuitos. **No usar Vercel Cron.**
- Claude decide con `claude -p` (suscripción Pro del usuario) desde un script local. En esa llamada Claude
  no tiene herramientas, ni MCP, ni red, ni acceso a la BD: solo el prompt → JSON.
- El motor de ejecución es código determinista (`src/core`), separado de Claude.
- Diario, órdenes, ejecuciones, eventos, snapshots, benchmarks: **append-only** (triggers + REVOKE) y con
  **hash encadenado** (trigger en BD, verificación independiente en TS).
- La clave secreta de Supabase solo en `.env.local` (local) y en secretos de GitHub Actions. Nunca en el
  frontend ni en el repo.

## Reglas del experimento (por defecto, configurables en la tabla `experiments`)
- Capital 10.000 €, divisa base EUR. Activos solo en **EUR o USD** (FX real EURUSD=X registrado en cada operación).
- Comisión 0,10 % (mín. 1 €), slippage 0,05 %, comisión de cambio 0 %. Sin apalancamiento, corto, derivados ni margen.
- Máx. 25 % de la cartera por activo (se comprueba al comprar; no se fuerza venta si sube por precio).
- Unidades enteras. Cripto desactivada.
- Mercados: EE. UU. (NYSE/Nasdaq/Arca/Cboe), Xetra, Euronext (París, Ámsterdam, Bruselas, Lisboa), BME.
  Exposición a China/India/LatAm/emergentes vía ADRs y ETFs cotizados en USD o EUR.
- Orden abierto + festivos: calendario propio (`src/core/calendar.ts`) **y** `marketState === REGULAR` de Yahoo.
- Órdenes: primero ventas, luego compras. Market → precio actual ± slippage. Limit → "como una persona normal":
  orden válida durante la sesión del día; si es ejecutable se ejecuta al momento, si no queda pendiente
  (reserva efectivo/acciones) y se comprueba con barras de 5 min en la siguiente ejecución o en el cierre;
  si el precio tocó el límite se ejecuta al precio límite, si no caduca al cierre del mercado.
- Claude solo puede operar tickers cuyos datos van en el prompt de esa ejecución (si no → rechazo).
- Dividendos en bruto (impuestos ignorados) y splits aplicados. Benchmarks: ETFs de acumulación.
- Sharpe con tipo libre de riesgo configurable (0 % por defecto).

## Arquitectura
- `src/core/` lógica pura y testeada (Vitest): calendario, comisiones, FX, motor, órdenes limitadas,
  cartera derivada del registro, benchmarks, métricas, hash canónico. La usan la web, el agente y el cierre.
- `src/app/` dashboard Next.js (App Router) — solo LEE de Supabase con la clave publicable + login.
- `agent/` scripts locales (NO se despliegan, ver `.vercelignore`): `run-agent`, `close-day`,
  `start-experiment`, `create-user`. Datos de mercado en `agent/lib/market/` (interfaz `MarketDataProvider`).
- `supabase/migrations/` SQL versionado (se aplica con el MCP de Supabase).
- `.github/workflows/close-day.yml` (solo manual; el cierre normal es la tarea CLOSE del PC) → snapshot de cierre diario (sin Claude) + caducidad de límites +
  dividendos/splits + ancla de hashes en `integrity/anchors.jsonl`.

## Infraestructura
- Supabase: proyecto `claude-trader`, ref `exbawucbremmdnoyupho`, región eu-central-1 (Frankfurt), org free.
- Datos: yahoo-finance2 (gratis, sin clave, no oficial). Retraso declarado por Yahoo: 15 min Xetra/BME/Nasdaq
  (campo `exchangeDataDelayedBy`), 0 Euronext Ámsterdam, 20 NYSE; se registra el retraso medido
  (fetched_at − regularMarketTime) en cada precio.
- Claude CLI: `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe` (variable `CLAUDE_BIN` para cambiarlo).
- Modelo del agente: `sonnet` (plan Pro); configurable en `experiments.agent_model`.
- Tareas programadas solo en el PC principal (L-V, hora de Madrid): P0 08:30 (preapertura: analiza Asia y
  deja un plan, SIN órdenes, journal kind `briefing`), S0 09:30 (apertura Europa), S1 16:30, S2 21:00 y CLOSE
  22:30 (cierre diario + academia los viernes). Horario único en `src/lib/schedule.ts` (ventanas incluidas).
  Decisión del usuario (2026-10-22): 4 reuniones al día; el portátil solo está enchufado algunas mañanas.
  El cierre ya no va en GitHub Actions (workflow solo manual); sin anclas de integridad automáticas.
- `npm run dev` / `npm run build` / `npm test`
- `npm run run-agent -- --slot P0|S0|S1|S2` (sin `--slot` = manual; `--briefing` = preapertura a mano; `--no-team` sin analistas)
- `npm run explain` (genera las explicaciones que falten), `npm run close-day`, `npm run start-experiment -- --code <code>`, `npm run create-user -- <email>`

## Estado de fases (actualizado 2026-10-18)
- [x] 0. Preparación — proyecto Supabase creado, Next.js 16 + Tailwind 4, `.env.local`
- [x] 1. BD + motor con tests — migraciones aplicadas; hash de la BD == hash de Node verificado
- [x] 2. Datos de mercado — Yahoo: 107/107 activos del universo OK (`npm run market-check`)
- [x] 3. Agente `claude -p` — prueba offline real OK (16 k caracteres de prompt, ~15 s, JSON válido)
- [x] 4. Dashboard — 7 páginas + login + CSV; build y lint OK
- [x] 5. Benchmarks y métricas — compra día 1, cierre diario, dividendos/splits, Sharpe, DD...
- [x] 6. Hash chain, duplicados, repo GitHub (PolParis/claude-trader), secretos y web en Vercel
- [x] 7. Tareas `ClaudeTrader-S1/S2` instaladas en el PC principal (PcPol)
- [ ] 8. Periodo de prueba (experimento `test-1`) → fecha oficial

## Pendientes del usuario (manuales)
- En el segundo PC: clonar el repo, `npm install` y copiar `.env.local` (NO instalar tareas).
- Usuario web creado: polparis7@gmail.com.

## Decisiones / notas
- Mandato del usuario (2026-10-18): Claude debe buscar acciones individuales de todo el mundo (China,
  emergentes...), no solo índices de EU/EE. UU. → regla 9 del system prompt + universo de 160 activos
  (ADRs en USD). Descartados: TCEHY (OTC), EBR (sin datos), SIFY (ilíquida).
- Explicaciones para principiantes (2026-10-19, petición del usuario: no sabe de inversión): tras cada
  ejecución, 2.ª llamada `claude -p` (`agent/lib/agent/explain.ts`) → tabla encadenada `explanations`
  (1 por run) → página `/explicaciones` (historia, reparto por país/tipo, glosario). Si falla, no afecta a
  las órdenes; se rellena con `npm run explain`.
- Equipo de agentes (2026-10-22, petición del usuario, inspirado en un "fondo gestionado por IA"):
  motor cuantitativo en código (`src/core/quant.ts`, `agent/lib/quant-report.ts`: riesgo, VaR/CVaR, beta,
  Monte Carlo bootstrap por bloques con deriva neutral del 5 %, estrés, correlaciones, contribución al
  riesgo, factores, post-mortem) → analista cuantitativo + gestora de riesgos (`agent/lib/agent/team.ts`,
  2 llamadas `claude -p` en paralelo, fallan sin bloquear) → gestor. Academia los viernes en la tarea
  CLOSE (`npm run academy`, `agent/lib/agent/academy.ts`): post-mortem + MANUAL DE ESTRATEGIA que lee el
  gestor. Todo en la tabla encadenada `agent_reports`. Web: `/oficina` (animación SVG) y `/cuantitativo`.
  Consumo: ~25 k tokens la decisión + ~10 k cada analista; prompt del gestor ~40 k caracteres.
- Web: https://claude-trader-livid.vercel.app (despliegue automático al hacer push a main).
- Rama principal `main`. Repo público (GitHub Actions gratis + transparencia).
- `cacheComponents` desactivado en `next.config.ts`: la web es privada y dinámica (sesión en cada petición).
- `package.json` con `"type": "module"` (los scripts usan top-level await con tsx).
- PowerShell 5.1 estropea UTF-8 al editar con Get/Set-Content: editar archivos con las herramientas de
  archivo o bash; los `.ps1` solo en ASCII.
- Experimentos: `test-1` (prueba, arranca solo en la primera ejecución con Europa abierta) y el oficial
  (se crea y arranca con `npm run start-experiment -- --code oficial --create --name "..."`).
- La web muestra el experimento con `is_default` (o el elegido en el selector, cookie `exp`).
- Claude se llama con `--tools "" --strict-mcp-config --safe-mode --no-session-persistence --json-schema`
  desde una carpeta temporal vacía. Un único reintento solo si el JSON es inválido y antes de escribir nada.
- Ejecución: precios refrescados justo antes de ejecutar (no los del prompt).
- `run-agent.ps1` espera hasta 2 min a tener red (DNS) al despertar: el 23/10 la P0 falló con "fetch failed"
  porque el Wi-Fi aún no había conectado tras la suspensión.
- Franjas programadas con ventana (S1 16:25–18:00, S2 20:55–22:00): si Windows lanza la tarea tarde
  (PC dormido en batería, sin temporizadores de activación) no hace nada y el cierre la marca fallida.
- Cierre diario: GitHub puede lanzar el cron con horas de retraso → antes de las 09:00 de Madrid se cierra
  el día anterior (`closingDay` en close-day.ts). 19/10: el cierre de GitHub falló (paso "Comprobar
  secretos" añadido para diagnosticar); el del 20/10 se hizo a mano desde PcPol.
- Anclas de integridad: solo las escribe GitHub Actions (`integrity/anchors.jsonl`); la página Integridad
  las compara con la BD.
