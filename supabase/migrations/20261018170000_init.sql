-- Claude vs. el Mercado — esquema inicial.
-- Tablas de eventos: append-only (sin UPDATE/DELETE/TRUNCATE) y con hash encadenado
-- por experimento: hash = sha256(prev_hash || '|' || payload). El payload es el JSON canónico
-- de los datos de la fila, generado por el escritor; el trigger asigna seq, prev_hash y hash.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

-- ---------- Funciones de integridad ----------

create or replace function private.forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception 'La tabla % es append-only: % no permitido', tg_table_name, tg_op;
end $$;

create or replace function private.chain_before_insert() returns trigger
language plpgsql as $$
declare
  last_seq bigint;
  last_hash text;
begin
  if new.payload is null or new.payload = '' then
    raise exception 'payload obligatorio en %', tg_table_name;
  end if;
  perform pg_advisory_xact_lock(hashtext(tg_table_name || ':' || new.experiment_id::text));
  execute format('select seq, hash from %I.%I where experiment_id = $1 order by seq desc limit 1',
                 tg_table_schema, tg_table_name)
    into last_seq, last_hash using new.experiment_id;
  new.seq := coalesce(last_seq, 0) + 1;
  new.prev_hash := coalesce(last_hash, 'GENESIS');
  new.hash := encode(extensions.digest(new.prev_hash || '|' || new.payload, 'sha256'), 'hex');
  new.recorded_at := now();
  return new;
end $$;

-- ---------- Experimentos ----------

create table public.experiments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  mode text not null check (mode in ('test', 'official')),
  started_at timestamptz,
  initial_capital numeric(14,2) not null default 10000,
  base_currency text not null default 'EUR',
  commission_pct numeric not null default 0.001,
  commission_min numeric not null default 1,
  slippage_pct numeric not null default 0.0005,
  fx_fee_pct numeric not null default 0,
  max_position_pct numeric not null default 0.25,
  allow_crypto boolean not null default false,
  allow_fractional boolean not null default false,
  risk_free_rate numeric not null default 0,
  max_quote_age_minutes integer not null default 30,
  agent_model text not null default 'sonnet',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- Una vez iniciado, las reglas económicas y la fecha de inicio no se pueden cambiar.
create or replace function private.experiments_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'No se pueden borrar experimentos';
  end if;
  if old.started_at is not null and (
       new.started_at is distinct from old.started_at
    or new.code is distinct from old.code
    or new.mode is distinct from old.mode
    or new.initial_capital is distinct from old.initial_capital
    or new.base_currency is distinct from old.base_currency
    or new.commission_pct is distinct from old.commission_pct
    or new.commission_min is distinct from old.commission_min
    or new.slippage_pct is distinct from old.slippage_pct
    or new.fx_fee_pct is distinct from old.fx_fee_pct
    or new.max_position_pct is distinct from old.max_position_pct
    or new.allow_crypto is distinct from old.allow_crypto
    or new.allow_fractional is distinct from old.allow_fractional
    or new.risk_free_rate is distinct from old.risk_free_rate
    or new.max_quote_age_minutes is distinct from old.max_quote_age_minutes) then
    raise exception 'El experimento % ya empezó: sus reglas y su fecha de inicio son inmutables', old.code;
  end if;
  return new;
end $$;

create trigger experiments_guard before update or delete on public.experiments
  for each row execute function private.experiments_guard();

-- ---------- Catálogo de instrumentos (caché de metadatos, modificable) ----------

create table public.instruments (
  symbol text primary key,
  name text not null,
  market text not null check (market in ('US', 'XETRA', 'EURONEXT', 'BME', 'CRYPTO')),
  currency text not null,
  kind text not null check (kind in ('stock', 'etf', 'crypto')),
  region text,
  yahoo_exchange text,
  updated_at timestamptz not null default now()
);

-- ---------- Ejecuciones (reserva de franja: protección contra duplicados) ----------

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id),
  run_date date not null,
  slot text not null,
  kind text not null check (kind in ('scheduled', 'manual', 'close', 'start')),
  hostname text not null,
  status text not null default 'reserved' check (status in ('reserved', 'completed', 'failed', 'skipped')),
  reserved_at timestamptz not null default now(),
  finished_at timestamptz,
  model text,
  prompt_sha256 text,
  prompt_chars integer,
  claude_result jsonb,
  summary jsonb,
  error text,
  duration_ms integer,
  unique (experiment_id, run_date, slot)
);

-- Solo se permite cerrar una reserva (reserved → estado final) una vez.
create or replace function private.runs_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'No se pueden borrar ejecuciones';
  end if;
  if old.status <> 'reserved' then
    raise exception 'La ejecución % ya está cerrada (%)', old.id, old.status;
  end if;
  if new.id <> old.id or new.experiment_id <> old.experiment_id or new.run_date <> old.run_date
     or new.slot <> old.slot or new.hostname <> old.hostname or new.reserved_at <> old.reserved_at
     or new.kind <> old.kind then
    raise exception 'Campos de identidad de la ejecución inmutables';
  end if;
  if new.status = 'reserved' then
    raise exception 'Una ejecución solo puede pasar a completed/failed/skipped';
  end if;
  return new;
end $$;

create trigger runs_guard before update or delete on public.runs
  for each row execute function private.runs_guard();

-- ---------- Registro de precios usados (append-only, sin cadena) ----------

create table public.price_quotes (
  id bigint generated always as identity primary key,
  experiment_id uuid references public.experiments(id),
  run_id uuid references public.runs(id),
  symbol text not null,
  price numeric not null,
  currency text,
  source text not null,
  quote_time timestamptz,
  fetched_at timestamptz not null,
  delay_s integer,
  declared_delay_min integer,
  market_state text
);
create index on public.price_quotes (run_id);

-- ---------- Tablas encadenadas ----------
-- Columnas comunes: payload, seq, prev_hash, hash, recorded_at.

create table public.journal_entries (
  id bigint generated always as identity primary key,
  experiment_id uuid not null references public.experiments(id),
  run_id uuid references public.runs(id),
  at timestamptz not null,
  kind text not null check (kind in ('decision', 'run_failed', 'run_skipped', 'system')),
  summary text not null,
  market_view text,
  thesis text,
  risks text,
  data_used text,
  change_mind text,
  horizon text,
  tickers text[] not null default '{}',
  payload text not null,
  seq bigint not null,
  prev_hash text not null,
  hash text not null,
  recorded_at timestamptz not null,
  unique (experiment_id, seq)
);

create table public.orders (
  id bigint generated always as identity primary key,
  experiment_id uuid not null references public.experiments(id),
  run_id uuid references public.runs(id),
  idx integer not null,
  at timestamptz not null,
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  quantity numeric not null,
  order_type text not null check (order_type in ('market', 'limit')),
  limit_price numeric,
  rationale text,
  status text not null check (status in ('filled', 'rejected', 'pending')),
  reject_code text,
  reject_reason text,
  reserved_cash_eur numeric,
  expires_at timestamptz,
  quote_price numeric,
  quote_currency text,
  quote_source text,
  quote_time timestamptz,
  quote_delay_s integer,
  declared_delay_min integer,
  payload text not null,
  seq bigint not null,
  prev_hash text not null,
  hash text not null,
  recorded_at timestamptz not null,
  unique (experiment_id, seq),
  unique (run_id, idx)
);

create table public.fills (
  id bigint generated always as identity primary key,
  experiment_id uuid not null references public.experiments(id),
  order_id bigint not null unique references public.orders(id),
  run_id uuid references public.runs(id),
  at timestamptz not null,
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  quantity numeric not null check (quantity > 0),
  price_local numeric not null,
  ref_price_local numeric not null,
  currency text not null,
  fx_rate numeric not null,
  fx_source text,
  fx_time timestamptz,
  gross_eur numeric not null,
  commission_eur numeric not null,
  fx_fee_eur numeric not null,
  cash_delta_eur numeric not null,
  price_source text not null,
  price_time timestamptz,
  payload text not null,
  seq bigint not null,
  prev_hash text not null,
  hash text not null,
  recorded_at timestamptz not null,
  unique (experiment_id, seq)
);

create table public.order_events (
  id bigint generated always as identity primary key,
  experiment_id uuid not null references public.experiments(id),
  order_id bigint not null unique references public.orders(id),
  run_id uuid references public.runs(id),
  at timestamptz not null,
  event text not null check (event in ('expired', 'cancelled')),
  reason text,
  payload text not null,
  seq bigint not null,
  prev_hash text not null,
  hash text not null,
  recorded_at timestamptz not null,
  unique (experiment_id, seq)
);

create table public.corporate_actions (
  id bigint generated always as identity primary key,
  experiment_id uuid not null references public.experiments(id),
  run_id uuid references public.runs(id),
  at timestamptz not null,
  symbol text not null,
  kind text not null check (kind in ('dividend', 'split')),
  ex_date date not null,
  amount_local numeric,
  ratio numeric,
  currency text,
  quantity_held numeric,
  fx_rate numeric,
  cash_eur numeric,
  source text not null,
  payload text not null,
  seq bigint not null,
  prev_hash text not null,
  hash text not null,
  recorded_at timestamptz not null,
  unique (experiment_id, seq),
  unique (experiment_id, symbol, kind, ex_date)
);

create table public.watchlist_events (
  id bigint generated always as identity primary key,
  experiment_id uuid not null references public.experiments(id),
  run_id uuid references public.runs(id),
  at timestamptz not null,
  symbol text not null,
  action text not null check (action in ('add', 'remove')),
  reason text,
  payload text not null,
  seq bigint not null,
  prev_hash text not null,
  hash text not null,
  recorded_at timestamptz not null,
  unique (experiment_id, seq)
);

create table public.benchmarks (
  id bigint generated always as identity primary key,
  experiment_id uuid not null references public.experiments(id),
  code text not null,
  name text not null,
  symbol text,
  currency text not null,
  units numeric not null,
  buy_price_local numeric not null,
  fx_rate numeric not null,
  gross_eur numeric not null,
  commission_eur numeric not null,
  cash_left_eur numeric not null,
  bought_at timestamptz not null,
  price_source text,
  payload text not null,
  seq bigint not null,
  prev_hash text not null,
  hash text not null,
  recorded_at timestamptz not null,
  unique (experiment_id, seq),
  unique (experiment_id, code)
);

create table public.snapshots (
  id bigint generated always as identity primary key,
  experiment_id uuid not null references public.experiments(id),
  run_id uuid references public.runs(id),
  kind text not null check (kind in ('start', 'run', 'close')),
  at timestamptz not null,
  snapshot_date date not null,
  cash_eur numeric not null,
  positions_value_eur numeric not null,
  total_eur numeric not null,
  holdings jsonb not null,
  benchmarks jsonb not null,
  payload text not null,
  seq bigint not null,
  prev_hash text not null,
  hash text not null,
  recorded_at timestamptz not null,
  unique (experiment_id, seq)
);
create unique index snapshots_one_close_per_day on public.snapshots (experiment_id, snapshot_date) where kind = 'close';

-- ---------- Triggers de cadena y append-only ----------

do $$
declare
  t text;
begin
  foreach t in array array['journal_entries', 'orders', 'fills', 'order_events', 'corporate_actions',
                           'watchlist_events', 'benchmarks', 'snapshots']
  loop
    execute format('create trigger %I before insert on public.%I for each row execute function private.chain_before_insert()',
                   t || '_chain', t);
  end loop;
  foreach t in array array['journal_entries', 'orders', 'fills', 'order_events', 'corporate_actions',
                           'watchlist_events', 'benchmarks', 'snapshots', 'price_quotes']
  loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.forbid_change()',
                   t || '_append_only', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function private.forbid_change()',
                   t || '_no_truncate', t);
    execute format('revoke update, delete, truncate on public.%I from anon, authenticated, service_role', t);
  end loop;
end $$;

-- ---------- Seguridad: lectura solo para usuarios con sesión ----------

do $$
declare
  t text;
begin
  foreach t in array array['experiments', 'instruments', 'runs', 'price_quotes', 'journal_entries', 'orders', 'fills',
                           'order_events', 'corporate_actions', 'watchlist_events', 'benchmarks', 'snapshots']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
  end loop;
end $$;

revoke delete, truncate on public.experiments, public.runs from service_role;

-- Experimento de prueba inicial.
insert into public.experiments (code, name, mode, is_default)
values ('test-1', 'Prueba 1', 'test', true);
