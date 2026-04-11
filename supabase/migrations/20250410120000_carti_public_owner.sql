-- Carti: catalog public + proprietar pentru filtrare pe rol (admin/user/guest)
ALTER TABLE carti ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE;
ALTER TABLE carti ADD COLUMN IF NOT EXISTS created_by_email TEXT;

CREATE INDEX IF NOT EXISTS idx_carti_public ON carti (is_public) WHERE is_public = TRUE;

COMMENT ON COLUMN carti.is_public IS 'If true, book appears in GET /carti/publice (landing).';
COMMENT ON COLUMN carti.created_by_email IS 'Owner email or guest bucket for /istoric; NULL = legacy rows.';
