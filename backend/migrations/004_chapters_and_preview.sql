-- Capitole in playlist + flag preview guest

ALTER TABLE carti_segmente ADD COLUMN IF NOT EXISTS chapter_index INT;
ALTER TABLE carti_segmente ADD COLUMN IF NOT EXISTS chapter_title TEXT;

ALTER TABLE carti ADD COLUMN IF NOT EXISTS is_guest_preview BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE carti ADD COLUMN IF NOT EXISTS source_char_total INT;
ALTER TABLE carti ADD COLUMN IF NOT EXISTS playlist_mode TEXT NOT NULL DEFAULT 'parts';

COMMENT ON COLUMN carti_segmente.chapter_index IS 'Grupare capitole (book mode); NULL = parti simple.';
COMMENT ON COLUMN carti.playlist_mode IS 'parts sau chapters — mod afisare playlist.';
