-- ============================================
-- 0020 — Optimisations perf + scalabilité (consolidée)
-- ============================================
-- Objectifs :
--   1) Index manquants sur FK et lookups fréquents (audit complet).
--   2) Nettoyage des sessions expirées (sinon croissance infinie).
--   3) Hygiène : supprimer les wikot_conversations vides.
--   4) ANALYZE pour recalculer les stats SQLite après ajout d'index.
-- Idempotente : tous les CREATE INDEX utilisent IF NOT EXISTS, safe à rejouer.
-- ============================================

-- ============================================
-- 1) MODULE TÂCHES — accès template/instance/assignment
-- ============================================
CREATE INDEX IF NOT EXISTS idx_task_instances_template_id
  ON task_instances(template_id) WHERE template_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_assignments_instance
  ON task_assignments(task_instance_id);

CREATE INDEX IF NOT EXISTS idx_task_assignments_user_date
  ON task_assignments(user_id, assigned_at DESC);

-- ============================================
-- 2) AI IMPORTS — historique récent par hôtel/type/applicant
-- ============================================
CREATE INDEX IF NOT EXISTS idx_ai_imports_hotel_type
  ON ai_imports(hotel_id, import_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_imports_applied_by
  ON ai_imports(applied_by, applied_at);

-- ============================================
-- 3) SESSIONS — purge rapide des expirées
-- ============================================
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
  ON user_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_expires
  ON user_sessions(user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_client_sessions_expires
  ON client_sessions(expires_at);

-- ============================================
-- 4) WIKOT MESSAGES — accès chronologique inversé pour LIMIT 30 DESC
-- (utilisé dans /api/wikot/conversations/:id/message pour récupérer l'historique récent)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_wikot_msg_conv_created_desc
  ON wikot_messages(conversation_id, created_at DESC);

-- ============================================
-- 5) WIKOT CONVERSATIONS — filtrage liste + tri updated_at
-- ============================================
CREATE INDEX IF NOT EXISTS idx_wikot_conv_updated
  ON wikot_conversations(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_wikot_conv_user_mode_updated
  ON wikot_conversations(user_id, mode, is_archived, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_wikot_conv_client_updated
  ON wikot_conversations(client_account_id, is_archived, updated_at DESC);

-- ============================================
-- 6) RESTAURANT RESERVATIONS — lookup hôtel/statut/date + créateur client
-- ============================================
CREATE INDEX IF NOT EXISTS idx_resa_hotel_status_date
  ON restaurant_reservations(hotel_id, status, reservation_date);

CREATE INDEX IF NOT EXISTS idx_resa_created_by_client
  ON restaurant_reservations(created_by_client_id, status);

-- ============================================
-- 7) CHAT MESSAGES — overview/unread (JOIN intensif sur (channel_id, id DESC))
-- ============================================
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_id_desc
  ON chat_messages(channel_id, id DESC);

-- ============================================
-- 8) HOTEL INFO ITEMS — catalogue front Wikot (hôtel, catégorie, ordre)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_hotel_info_items_hotel_cat_sort
  ON hotel_info_items(hotel_id, category_id, sort_order);

-- ============================================
-- 9) PROCEDURES — listes par hôtel + statut + tri titre
-- ============================================
CREATE INDEX IF NOT EXISTS idx_procedures_hotel_status_title
  ON procedures(hotel_id, status, title);

-- ============================================
-- 10) ROOMS — lookup par numéro de chambre (imports IA + bulk)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_rooms_hotel_number
  ON rooms(hotel_id, room_number, is_active);

-- ============================================
-- 11) CLIENT ACCOUNTS — purge automatique par checkout_date
-- ============================================
CREATE INDEX IF NOT EXISTS idx_client_accounts_checkout
  ON client_accounts(hotel_id, checkout_date, is_active);

-- ============================================
-- 12) CHANGELOG — feed récent par hôtel
-- ============================================
CREATE INDEX IF NOT EXISTS idx_changelog_hotel_created
  ON changelog(hotel_id, created_at DESC);

-- ============================================
-- 13) NETTOYAGE DES DONNÉES OBSOLÈTES
-- ============================================
-- Sessions expirées (purge ponctuelle, le runtime fait déjà du cleanup)
DELETE FROM user_sessions   WHERE expires_at < CURRENT_TIMESTAMP;
DELETE FROM client_sessions WHERE expires_at < CURRENT_TIMESTAMP;

-- Conversations Wikot vides (créées sans aucun message) — orphan cleanup
DELETE FROM wikot_messages
  WHERE conversation_id IN (
    SELECT c.id FROM wikot_conversations c
    LEFT JOIN wikot_messages m ON m.conversation_id = c.id
    WHERE m.id IS NULL
  );

DELETE FROM wikot_conversations
  WHERE id IN (
    SELECT c.id FROM wikot_conversations c
    LEFT JOIN wikot_messages m ON m.conversation_id = c.id
    WHERE m.id IS NULL
  );

-- ============================================
-- 14) ANALYZE — recalcule les stats SQLite après ajout des index
-- (le planner choisira mieux les index sur les requêtes complexes)
-- ============================================
ANALYZE;
