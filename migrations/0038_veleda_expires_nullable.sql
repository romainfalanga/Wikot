-- Migration 0038 : rendre expires_at NULLABLE sur veleda_notes
-- Raison : on autorise les notes "permanentes" (sans date de disparition).
-- expires_at IS NULL  => note jamais auto-supprimee par le cleanup.
-- expires_at NOT NULL => comportement historique (auto-cleanup quand passe).
--
-- SQLite ne supporte pas ALTER COLUMN. Strategie :
--  1) Cree une nouvelle table avec expires_at NULL autorise
--  2) Copie les donnees
--  3) Drop l'ancienne table + renomme
--  4) Recree les index

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS veleda_notes_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  expires_at DATETIME,                    -- NULLABLE : NULL = note permanente
  created_by INTEGER,
  created_by_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  pos_x INTEGER,
  pos_y INTEGER,
  width INTEGER,
  height INTEGER,
  color TEXT NOT NULL DEFAULT 'black',
  font TEXT NOT NULL DEFAULT 'Kalam',
  is_board INTEGER NOT NULL DEFAULT 0,
  parent_note_id INTEGER,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_note_id) REFERENCES veleda_notes(id) ON DELETE CASCADE
);

INSERT INTO veleda_notes_new
  (id, hotel_id, title, content, expires_at, created_by, created_by_name,
   created_at, updated_at, pos_x, pos_y, width, height, color, font, is_board, parent_note_id)
SELECT
   id, hotel_id, title, content, expires_at, created_by, created_by_name,
   created_at, updated_at, pos_x, pos_y, width, height, color, font, is_board, parent_note_id
FROM veleda_notes;

DROP TABLE veleda_notes;
ALTER TABLE veleda_notes_new RENAME TO veleda_notes;

-- Recreation des index
CREATE INDEX IF NOT EXISTS idx_veleda_hotel_expires
  ON veleda_notes(hotel_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_veleda_parent
  ON veleda_notes(parent_note_id);

PRAGMA foreign_keys = ON;
