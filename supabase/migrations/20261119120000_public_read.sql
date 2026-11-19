-- Web pública: lectura (solo SELECT) también para visitantes sin sesión (rol anon).
-- La escritura sigue reservada a los scripts locales con la clave secreta.
do $$
declare
  t text;
begin
  foreach t in array array['experiments', 'instruments', 'runs', 'price_quotes', 'journal_entries', 'orders', 'fills',
                           'order_events', 'corporate_actions', 'watchlist_events', 'benchmarks', 'snapshots',
                           'explanations', 'agent_reports']
  loop
    execute format('grant select on public.%I to anon', t);
    execute format('create policy %I on public.%I for select to anon using (true)', t || '_public_read', t);
  end loop;
end $$;
