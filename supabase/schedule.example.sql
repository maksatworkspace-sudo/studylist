-- Run only after the live URL and matching JOBS_SECRET are stored in Supabase Vault
-- as maxball_app_url and maxball_jobs_secret. Enable pg_cron and pg_net first.
select cron.schedule(
  'maxball-background-jobs',
  '* * * * *',
  $$select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='maxball_app_url') || '/api/jobs',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='maxball_jobs_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );$$
);
