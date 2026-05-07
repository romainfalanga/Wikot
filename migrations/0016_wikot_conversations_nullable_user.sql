-- ============================================
-- 0016 : Rendre wikot_conversations.user_id nullable
-- ============================================
-- Front Wikot (côté client) crée des conversations attachées à un client_account
-- (pas à un user staff). user_id doit donc pouvoir être NULL.
-- SQLite ne supporte pas ALTER COLUMN DROP NOT NULL : on recrée la table.

-- 1. Nouvelle table avec user_id nullable
CREATE TABLE IF NOT EXISTS wikot_conversations_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  user_id INTEGER,
  title TEXT NOT NULL DEFAULT 'Nouvelle conversation',
  is_archived INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  mode TEXT DEFAULT 'standard',
  workflow_mode TEXT,
  target_kind TEXT,
  target_id INTEGER,
  client_account_id INTEGER,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (client_account_id) REFERENCES client_accounts(id),
  CHECK (user_id IS NOT NULL OR client_account_id IS NOT NULL)
);

-- 2. Copier les données existantes
INSERT INTO wikot_conversations_new (id, hotel_id, user_id, title, is_archived, created_at, updated_at, mode, workflow_mode, target_kind, target_id, client_account_id)
SELECT id, hotel_id, user_id, title, is_archived, created_at, updated_at, mode, workflow_mode, target_kind, target_id, client_account_id
FROM wikot_conversations;

-- 3. Remplacer la table d'origine
DROP TABLE wikot_conversations;
ALTER TABLE wikot_conversations_new RENAME TO wikot_conversations;

-- 4. Recréer les index
CREATE INDEX IF NOT EXISTS idx_wikot_conv_user ON wikot_conversations(user_id, mode, is_archived);
CREATE INDEX IF NOT EXISTS idx_wikot_conv_client ON wikot_conversations(client_account_id, mode, is_archived);
CREATE INDEX IF NOT EXISTS idx_wikot_conv_hotel ON wikot_conversations(hotel_id);
