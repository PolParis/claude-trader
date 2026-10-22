-- Informes del equipo de agentes: motor cuantitativo (código), analista cuantitativo, gestora de
-- riesgos y academia (post-mortem semanal + manual de estrategia). Append-only y encadenado.

create table public.agent_reports (
  id bigint generated always as identity primary key,
  experiment_id uuid not null references public.experiments(id),
  run_id uuid references public.runs(id),
  at timestamptz not null,
  agent text not null check (agent in ('quant_engine', 'quant_analyst', 'risk_manager', 'academy')),
  period text, -- academia: semana ISO (p. ej. 2026-W43)
  summary text not null,
  content jsonb not null,
  model text,
  duration_ms integer,
  payload text not null,
  seq bigint not null,
  prev_hash text not null,
  hash text not null,
  recorded_at timestamptz not null,
  unique (experiment_id, seq)
);
create unique index agent_reports_one_per_run on public.agent_reports (run_id, agent) where run_id is not null;
create unique index agent_reports_one_academy_per_week on public.agent_reports (experiment_id, period) where agent = 'academy';

create trigger agent_reports_chain before insert on public.agent_reports
  for each row execute function private.chain_before_insert();
create trigger agent_reports_append_only before update or delete on public.agent_reports
  for each row execute function private.forbid_change();
create trigger agent_reports_no_truncate before truncate on public.agent_reports
  for each statement execute function private.forbid_change();
revoke update, delete, truncate on public.agent_reports from anon, authenticated, service_role;

alter table public.agent_reports enable row level security;
revoke all on public.agent_reports from anon;
revoke insert, update, delete, truncate on public.agent_reports from authenticated;
create policy agent_reports_read on public.agent_reports for select to authenticated using (true);
