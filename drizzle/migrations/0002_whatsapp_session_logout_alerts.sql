CREATE TABLE public.wa_sessions (
 session_id uuid PRIMARY KEY,
 state text NOT NULL CHECK (state IN ('connected','logged_out')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 alert_state text NOT NULL DEFAULT 'none' CHECK (alert_state IN ('none','pending','sending','sent')),
 telegram_message_id bigint,
 alert_error text
);
GRANT ALL ON public.wa_sessions TO service_role;
ALTER TABLE public.wa_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_session_access ON public.wa_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX wa_session_pending_alerts ON public.wa_sessions (updated_at) WHERE alert_state = 'pending';