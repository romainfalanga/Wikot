-- Migration 0021 : drop wikot_messages + is_archived (mémoire Wikot retirée)
-- ============================================
-- Contexte : la mémoire des conversations Wikot a été retirée côté code.
-- Chaque message est désormais traité de façon stateless. Cette migration :
--   1. Supprime la table wikot_messages (et ses index)
--   2. Recrée wikot_pending_actions sans la FK morte vers wikot_messages
--      (message_id devient nullable car il référençait une table supprimée)
--   3. Supprime la colonne is_archived de wikot_conversations (devenue morte :
--      DELETE physique au lieu d'archivage)
--   4. Recrée les index Wikot sans is_archived
-- Idempotent : peut être ré-appliqué sans casser une DB déjà migrée.

-- ============================================
-- 1) DROP des index liés à wikot_messages
-- ============================================
DROP INDEX IF EXISTS idx_wikot_msg_conv;
DROP INDEX IF EXISTS idx_wikot_msg_conv_created_desc;
DROP INDEX IF EXISTS idx_wikot_messages_audio_key;

-- ============================================
-- 2) DROP des index liés à wikot_pending_actions (recréés à l'étape 4)
-- ============================================
DROP INDEX IF EXISTS idx_wikot_action_conv;
DROP INDEX IF EXISTS idx_wikot_action_msg;

-- ============================================
-- 3) Recréation de wikot_pending_actions sans FK morte
-- ============================================
-- SQLite ne supporte pas DROP CONSTRAINT, donc on recrée la table.
-- On préserve les données existantes (les pending_actions actives restent valides).
CREATE TABLE IF NOT EXISTS wikot_pending_actions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  message_id INTEGER,        -- nullable maintenant (FK vers wikot_messages supprimée)
  hotel_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  before_snapshot TEXT,
  status TEXT DEFAULT 'pending',
  result_id INTEGER,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  FOREIGN KEY (conversation_id) REFERENCES wikot_conversations(id) ON DELETE CASCADE
);

-- Copie des données existantes (au cas où la table existait déjà)
INSERT INTO wikot_pending_actions_new
  (id, conversation_id, message_id, hotel_id, user_id, action_type,
   payload, before_snapshot, status, result_id, error_message, created_at, resolved_at)
SELECT id, conversation_id, message_id, hotel_id, user_id, action_type,
       payload, before_snapshot, status, result_id, error_message, created_at, resolved_at
FROM wikot_pending_actions;

DROP TABLE wikot_pending_actions;
ALTER TABLE wikot_pending_actions_new RENAME TO wikot_pending_actions;

-- Index utiles
CREATE INDEX IF NOT EXISTS idx_wikot_action_conv
  ON wikot_pending_actions(conversation_id, status);
CREATE INDEX IF NOT EXISTS idx_wikot_action_user_status
  ON wikot_pending_actions(user_id, status, created_at DESC);

-- ============================================
-- 4) DROP de la table wikot_messages
-- ============================================
DROP TABLE IF EXISTS wikot_messages;

-- ============================================
-- 5) DROP des index Wikot conversations qui référencent is_archived
-- ============================================
DROP INDEX IF EXISTS idx_wikot_conv_user;
DROP INDEX IF EXISTS idx_wikot_conv_client;
DROP INDEX IF EXISTS idx_wikot_conv_workflow;
DROP INDEX IF EXISTS idx_wikot_conv_user_mode_updated;
DROP INDEX IF EXISTS idx_wikot_conv_client_updated;

-- ============================================
-- 6) DROP de la colonne is_archived sur wikot_conversations
-- ============================================
-- SQLite ≥ 3.35 supporte DROP COLUMN nativement (Cloudflare D1 = OK).
ALTER TABLE wikot_conversations DROP COLUMN is_archived;

-- ============================================
-- 7) Recréation des index sans is_archived
-- ============================================
CREATE INDEX IF NOT EXISTS idx_wikot_conv_user_mode_updated
  ON wikot_conversations(user_id, mode, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_wikot_conv_client_updated
  ON wikot_conversations(client_account_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_wikot_conv_workflow
  ON wikot_conversations(user_id, workflow_mode, updated_at DESC);

-- ============================================
-- 8) Recalcule des stats SQLite après gros changement de schéma
-- ============================================
ANALYZE;
