-- Sesiuni guest (credite) + segmente audio per carte (playlist)

CREATE TABLE IF NOT EXISTS guest_sessions (
    id UUID PRIMARY KEY,
    credits_remaining INT NOT NULL DEFAULT 3000,
    credits_used INT NOT NULL DEFAULT 0,
    jobs_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE TABLE IF NOT EXISTS carti_segmente (
    id BIGSERIAL PRIMARY KEY,
    carte_id BIGINT NOT NULL REFERENCES carti(id) ON DELETE CASCADE,
    segment_index INT NOT NULL,
    text_fragment TEXT NOT NULL,
    audio_link TEXT NOT NULL,
    char_count INT NOT NULL DEFAULT 0,
    creat_la TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (carte_id, segment_index)
);

CREATE INDEX IF NOT EXISTS idx_carti_segmente_carte ON carti_segmente (carte_id, segment_index);

ALTER TABLE carti ADD COLUMN IF NOT EXISTS guest_session_id UUID;

CREATE INDEX IF NOT EXISTS idx_carti_guest_session ON carti (guest_session_id) WHERE guest_session_id IS NOT NULL;

COMMENT ON TABLE guest_sessions IS 'Credite caractere pentru oaspeti anonimi (fara cont utilizator).';
COMMENT ON TABLE carti_segmente IS 'Fragmente TTS individuale — playlist per carte.';
COMMENT ON COLUMN carti.guest_session_id IS 'Izolare biblioteca guest; NULL pentru admin/user.';

-- RLS: tabele accesate doar din backend (service role). Anon/authenticated nu au politici = acces blocat.
ALTER TABLE guest_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE carti_segmente ENABLE ROW LEVEL SECURITY;
