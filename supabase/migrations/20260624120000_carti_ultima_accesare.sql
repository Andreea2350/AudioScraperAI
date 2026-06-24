-- Ultima deschidere a cărții în bibliotecă (per utilizator, pe rândul cărții).

ALTER TABLE carti ADD COLUMN IF NOT EXISTS ultima_accesare TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_carti_ultima_accesare ON carti (ultima_accesare DESC NULLS LAST);

COMMENT ON COLUMN carti.ultima_accesare IS 'Ultima dată când proprietarul a deschis cartea în bibliotecă.';
