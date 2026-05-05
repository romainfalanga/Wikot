-- ============================================
-- 0008 — Agent IA Wikot + Permissions granulaires
-- ============================================

-- ============================================
-- PARTIE A — Permissions granulaires sur les employés
-- ============================================
-- Ajout de can_edit_info et can_manage_chat
-- (can_edit_procedures existe déjà depuis migration 0002)

ALTER TABLE users ADD COLUMN can_edit_info INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN can_manage_chat INTEGER DEFAULT 0;

-- Migration des employés actuels qui ont can_edit_procedures=1
-- → on leur donne tout (can_edit_info=1, can_manage_chat=1)
UPDATE users
SET can_edit_info = 1, can_manage_chat = 1
WHERE can_edit_procedures = 1;

-- ============================================
-- PARTIE B — Tables pour l'agent IA Wikot
-- ============================================

-- Table des conversations (privées par utilisateur)
CREATE TABLE IF NOT EXISTS wikot_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT 'Nouvelle conversation',
  is_archived INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wikot_conv_user ON wikot_conversations(user_id, is_archived, updated_at DESC);

-- Table des messages (mémoire conversationnelle)
CREATE TABLE IF NOT EXISTS wikot_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL, -- 'user' | 'assistant' | 'tool'
  content TEXT,
  tool_calls TEXT,    -- JSON : appels d'outils faits par l'assistant
  tool_call_id TEXT,  -- ID de l'appel d'outil (pour role='tool')
  references_json TEXT, -- JSON : boutons de sourcing affichés à l'utilisateur [{type:'procedure',id:1,title:'...'}]
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES wikot_conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wikot_msg_conv ON wikot_messages(conversation_id, created_at);

-- Table des actions en attente de validation (création/modification proposée par Wikot)
CREATE TABLE IF NOT EXISTS wikot_pending_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  hotel_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  action_type TEXT NOT NULL, -- 'create_procedure' | 'update_procedure' | 'create_info_item' | 'update_info_item' | 'create_info_category'
  payload TEXT NOT NULL,     -- JSON de la modification proposée
  before_snapshot TEXT,      -- JSON de l'état actuel (pour les updates)
  status TEXT DEFAULT 'pending', -- 'pending' | 'accepted' | 'rejected' | 'failed'
  result_id INTEGER,         -- ID de la ressource créée/modifiée après acceptation
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  FOREIGN KEY (conversation_id) REFERENCES wikot_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES wikot_messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wikot_action_conv ON wikot_pending_actions(conversation_id, status);
CREATE INDEX IF NOT EXISTS idx_wikot_action_msg ON wikot_pending_actions(message_id);
