-- Explicaciones para principiantes: después de cada ejecución, Claude explica en lenguaje
-- sencillo qué ha hecho y por qué. Append-only y con hash encadenado como el resto del registro.

create table public.explanations (
  id bigint generated always as identity primary key,
  experiment_id uuid not null references public.experiments(id),
  run_id uuid not null references public.runs(id),
  at timestamptz not null,
  headline text not null,
  body text not null,
  operations jsonb not null default '[]',
  concepts jsonb not null default '[]',
  next_watch text,
  model text,
  payload text not null,
  seq bigint not null,
  prev_hash text not null,
  hash text not null,
  recorded_at timestamptz not null,
  unique (experiment_id, seq),
  unique (run_id)
);

create trigger explanations_chain before insert on public.explanations
  for each row execute function private.chain_before_insert();
create trigger explanations_append_only before update or delete on public.explanations
  for each row execute function private.forbid_change();
create trigger explanations_no_truncate before truncate on public.explanations
  for each statement execute function private.forbid_change();
revoke update, delete, truncate on public.explanations from anon, authenticated, service_role;

alter table public.explanations enable row level security;
revoke all on public.explanations from anon;
revoke insert, update, delete, truncate on public.explanations from authenticated;
create policy explanations_read on public.explanations for select to authenticated using (true);
