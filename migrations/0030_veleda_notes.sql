-- 0030 — Tableau Véléda (notes éphémères par hôtel)
-- ============================================
-- Permet à n'importe quel membre du staff de noter des informations
-- éphémères ("Ch. 204 : check-out 14h", "Livreur attendu mardi", etc.)
-- accessibles à tout le staff de l'hôtel, avec une date d'expiration
-- au-delà de laquelle la note est automatiquement supprimée.
--
-- Sécurité multi-tenant : hotel_id obligatoire + index, cleanup lazy
-- à chaque GET pour éviter une cron table.

CREATE TABLE IF NOT EXISTS veleda_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  title TEXT,                                    -- court, optionnel (ex: "Ch. 204")
  content TEXT NOT NULL,                         -- l'information elle-même
  expires_at DATETIME NOT NULL,                  -- au-delà : note auto-supprimée
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL,                 -- dénormalisé pour affichage rapide
                                                  -- (et conservé même si user supprimé)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index principal : liste filtrée par hôtel + tri/cleanup par date d'expiration
CREATE INDEX IF NOT EXISTS idx_veleda_hotel_expires
  ON veleda_notes(hotel_id, expires_at);
