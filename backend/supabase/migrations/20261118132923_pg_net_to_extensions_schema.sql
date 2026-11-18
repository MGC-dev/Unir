-- pg_net belongs in the `extensions` schema, not `public` (Supabase advisor). New setups already get it there from
-- agent_schedules; this moves it on projects that installed it in `public` first. The cron job is unaffected: it
-- calls net.http_post, and pg_net always keeps its functions in the `net` schema.
do $$ begin
  if exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_net' and n.nspname <> 'extensions') then
    drop extension pg_net;
    create extension pg_net with schema extensions;
  end if;
end $$;
