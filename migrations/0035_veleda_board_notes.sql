-- Migration 0035 : notes-tableaux (arborescence sur le tableau Veleda)
-- Une note peut devenir elle-meme un sous-tableau (is_board = 1).
-- Les notes filles ont un parent_note_id qui pointe vers la note-tableau parente.
-- Si parent_note_id est NULL, la note appartient au tableau racine.

ALTER TABLE veleda_notes ADD COLUMN is_board INTEGER NOT NULL DEFAULT 0;
ALTER TABLE veleda_notes ADD COLUMN parent_note_id INTEGER REFERENCES veleda_notes(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_veleda_parent ON veleda_notes(parent_note_id);
CREATE INDEX IF NOT EXISTS idx_veleda_hotel_parent ON veleda_notes(hotel_id, parent_note_id);
