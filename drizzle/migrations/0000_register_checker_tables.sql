CREATE TABLE public.registered_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  phone text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.registered_users TO service_role;
ALTER TABLE public.registered_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages registered_users" ON public.registered_users FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.wa_check_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','skipped')),
  note TEXT,
  provider_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.bot_chats (
  chat_id BIGINT PRIMARY KEY,
  first_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_check_numbers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bot_chats TO service_role;
ALTER TABLE public.wa_check_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages wa_check_numbers" ON public.wa_check_numbers FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role manages bot_chats" ON public.bot_chats FOR ALL TO service_role USING (true) WITH CHECK (true);