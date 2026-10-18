# Claude vs. el Mercado

Experimento: una IA (Claude) gestiona una cartera de **10.000 € ficticios** sobre precios reales
del mercado para comprobar si bate a los índices de referencia.

> **Dinero 100 % ficticio.** Es una simulación (paper trading): no hay ningún bróker ni cuenta real.
> Las decisiones de Claude **no son consejo financiero** y el autor no las replica.

## Cómo funciona

```
Programador de tareas (L-V 16:30 y 21:00)
  └─ npm run run-agent ─ datos de Yahoo Finance ─ claude -p (sin herramientas) ─ JSON
                          └─ motor determinista (comisiones, slippage, horarios, límites) ─ Supabase
GitHub Actions (L-V tras el cierre) ─ npm run close-day ─ snapshot de cierre + anclas de integridad
Vercel ─ dashboard Next.js (solo lectura, con login)
```

- `src/core/` — motor, calendario de mercados, cartera, benchmarks, métricas y hash encadenado (con tests).
- `src/app/` — dashboard.
- `agent/` — scripts locales (no se despliegan).
- `supabase/migrations/` — esquema: tablas append-only con hash encadenado.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm test` | Tests del motor |
| `npm run dev` | Web en local (http://localhost:3000) |
| `npm run market-check` | Comprueba la fuente de datos de mercado |
| `npm run run-agent -- --dry-run` | Ejecución completa sin escribir nada |
| `npm run run-agent` | Ejecución manual |
| `npm run close-day` | Cierre diario manual |
| `npm run start-experiment -- --code oficial --create --name "Experimento oficial"` | Lanza el experimento oficial |

Configuración: copia `.env.example` a `.env.local` y rellena las claves. Detalles y estado del proyecto en `CLAUDE.md`.
