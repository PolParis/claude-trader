-- Fija el search_path de las funciones de trigger (aviso de seguridad de Supabase).
alter function private.forbid_change() set search_path = '';
alter function private.chain_before_insert() set search_path = '';
alter function private.experiments_guard() set search_path = '';
alter function private.runs_guard() set search_path = '';
