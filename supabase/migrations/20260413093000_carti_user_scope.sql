-- Biblioteca per utilizator (fara schimbarea stack-ului curent de autentificare).
-- user_id indica utilizatorul din tabelul aplicatiei `utilizatori`.
ALTER TABLE public.carti
ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES public.utilizatori(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_carti_user_id ON public.carti (user_id);
CREATE INDEX IF NOT EXISTS idx_carti_user_url ON public.carti (user_id, url);

ALTER TABLE public.carti ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "carti_service_role_all" ON public.carti;
CREATE POLICY "carti_service_role_all"
ON public.carti
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');
