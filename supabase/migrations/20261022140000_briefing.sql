-- Reunión de preapertura (08:30): el equipo analiza y deja un plan, sin órdenes.
alter table public.journal_entries drop constraint journal_entries_kind_check;
alter table public.journal_entries add constraint journal_entries_kind_check
  check (kind in ('decision', 'briefing', 'run_failed', 'run_skipped', 'system'));
