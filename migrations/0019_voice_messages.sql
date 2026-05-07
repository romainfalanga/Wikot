-- Migration 0019 : Support des messages vocaux dans Wikot
-- Ajoute les colonnes nécessaires pour stocker les références aux fichiers audio R2
-- sur les messages utilisateur (côté staff Wikot et côté client Front Wikot).

-- Colonnes audio sur wikot_messages (staff)
ALTER TABLE wikot_messages ADD COLUMN audio_key TEXT;
ALTER TABLE wikot_messages ADD COLUMN audio_mime TEXT;
ALTER TABLE wikot_messages ADD COLUMN audio_duration_ms INTEGER;
ALTER TABLE wikot_messages ADD COLUMN audio_size_bytes INTEGER;

-- Index pour retrouver vite les messages avec audio (pour purge éventuelle)
CREATE INDEX IF NOT EXISTS idx_wikot_messages_audio_key ON wikot_messages(audio_key)
  WHERE audio_key IS NOT NULL;
