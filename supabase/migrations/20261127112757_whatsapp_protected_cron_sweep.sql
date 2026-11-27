do $schedule$
declare cmd text;
begin
 select command into cmd from cron.job where jobname='telegram-outbox-worker-sweep' and active;
 if cmd is null or position('x-cron-secret' in lower(cmd))=0 or position('/telegram-outbox-worker' in cmd)=0 then raise exception 'Existing protected cron invocation not available; configure WhatsApp scheduler explicitly';end if;
 if not exists(select 1 from cron.job where jobname='whatsapp-invoice-worker-sweep') then
 perform cron.schedule('whatsapp-invoice-worker-sweep','*/3 * * * *',replace(cmd,'/telegram-outbox-worker','/whatsapp-invoice-worker'));
 end if;
end $schedule$;