-- ============================================================
-- 0025 — CLEANUP : suppression espace client + restaurant + chambres + codes wikot
-- ============================================================
-- Tables supprimées (front client + restaurant + chambres):
--   - client_sessions, client_accounts (espace client / Front Wikot)
--   - room_occupancy (occupation historique)
--   - rooms (chambres — ne servaient qu'au login client)
--   - restaurant_reservations, restaurant_schedule, restaurant_templates,
--     restaurant_exceptions, restaurant_week_templates
-- Colonnes supprimées:
--   - hotels.client_login_code (code login client)
--   - users.can_edit_clients, users.can_edit_restaurant (permissions devenues inutiles)
--   - wikot_conversations.client_account_id (FK orpheline vers client_accounts)
-- ============================================================

-- 0) wikot_conversations : virer la colonne client_account_id et la FK associée
--    SQLite : pas de DROP CONSTRAINT, on recrée la table sans la FK + colonne.
--    Les conversations créées par des clients (user_id IS NULL) sont supprimées.
--    Note : wikot_messages a été drop par la migration 0021, donc rien à purger là.
DELETE FROM wikot_conversations WHERE user_id IS NULL;

CREATE TABLE wikot_conversations_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT 'Nouvelle conversation',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  mode TEXT DEFAULT 'standard',
  workflow_mode TEXT,
  target_kind TEXT,
  target_id INTEGER,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

INSERT INTO wikot_conversations_new
  (id, hotel_id, user_id, title, created_at, updated_at, mode, workflow_mode, target_kind, target_id)
SELECT id, hotel_id, user_id, title, created_at, updated_at, mode, workflow_mode, target_kind, target_id
FROM wikot_conversations;

DROP TABLE wikot_conversations;
ALTER TABLE wikot_conversations_new RENAME TO wikot_conversations;

CREATE INDEX IF NOT EXISTS idx_wikot_conv_hotel_user ON wikot_conversations(hotel_id, user_id);
CREATE INDEX IF NOT EXISTS idx_wikot_conv_updated ON wikot_conversations(updated_at);

-- 1) Drop tables — ordre important pour respecter les FK existantes
--    restaurant_reservations a une FK vers client_accounts (created_by_client_id)
--    → on drop le restaurant en PREMIER, puis le client/rooms ensuite.
DROP TABLE IF EXISTS restaurant_reservations;
DROP TABLE IF EXISTS restaurant_schedule;
DROP TABLE IF EXISTS restaurant_templates;
DROP TABLE IF EXISTS restaurant_exceptions;
DROP TABLE IF EXISTS restaurant_week_templates;

DROP TABLE IF EXISTS client_sessions;
DROP TABLE IF EXISTS client_accounts;
DROP TABLE IF EXISTS room_occupancy;
DROP TABLE IF EXISTS rooms;

-- 2) Drop colonnes hotels.client_login_code (drop l'index dépendant d'abord)
DROP INDEX IF EXISTS idx_hotels_client_code;
ALTER TABLE hotels DROP COLUMN client_login_code;

-- 3) Drop colonnes users.can_edit_clients / can_edit_restaurant
ALTER TABLE users DROP COLUMN can_edit_clients;
ALTER TABLE users DROP COLUMN can_edit_restaurant;
