-- Keep the Telegram text/document delivery stages separately recoverable.
ALTER TABLE public.telegram_outbox ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE public.telegram_outbox ADD COLUMN IF NOT EXISTS telegram_document_id text;
CREATE INDEX IF NOT EXISTS telegram_outbox_sending_claim_idx ON public.telegram_outbox(claimed_at) WHERE status='sending';
