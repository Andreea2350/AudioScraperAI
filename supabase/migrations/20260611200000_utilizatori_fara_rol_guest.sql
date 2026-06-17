-- Doar admin si user pot avea cont in utilizatori (oaspetele anonim = doar JWT, fara rand in DB).
ALTER TABLE utilizatori DROP CONSTRAINT IF EXISTS utilizatori_rol_check;
ALTER TABLE utilizatori ADD CONSTRAINT utilizatori_rol_check CHECK (rol IN ('admin', 'user'));
