-- Migration 0020 : Optimisation performance - index manquants
-- Objectif : accélérer les requêtes les plus fréquentes identifiées par audit
-- Aucune donnée modifiée, uniquement des index ajoutés (idempotents).

-- =============================================
-- WIKOT MESSAGES — accès chronologique inversé pour historique récent
-- =============================================
CREATE INDEX IF NOT EXISTS idx_wikot_msg_conv_created_desc
  ON wikot_messages(conversation_id, created_at DESC);

-- =============================================
-- WIKOT CONVERSATIONS — listes par user/hotel + tri updated_at
-- =============================================
CREATE INDEX IF NOT EXISTS idx_wikot_conv_user_mode_updated
  ON wikot_conversations(user_id, mode, is_archived, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_wikot_conv_client_updated
  ON wikot_conversations(client_account_id, is_archived, updated_at DESC);

-- =============================================
-- HOTEL_INFO_ITEMS — recherches par hotel + catégorie + tri
-- =============================================
CREATE INDEX IF NOT EXISTS idx_hotel_info_items_hotel_cat_sort
  ON hotel_info_items(hotel_id, category_id, sort_order);

-- =============================================
-- PROCEDURES — listes par hotel + statut + titre
-- =============================================
CREATE INDEX IF NOT EXISTS idx_procedures_hotel_status_title
  ON procedures(hotel_id, status, title);

-- =============================================
-- ROOMS — lookup par numéro de chambre (utilisé dans imports IA + bulk)
-- =============================================
CREATE INDEX IF NOT EXISTS idx_rooms_hotel_number
  ON rooms(hotel_id, room_number, is_active);

-- =============================================
-- CLIENT_ACCOUNTS — lookup par checkout_date pour purge automatique
-- =============================================
CREATE INDEX IF NOT EXISTS idx_client_accounts_checkout
  ON client_accounts(hotel_id, checkout_date, is_active);

-- =============================================
-- RESTAURANT_RESERVATIONS — recherches par client/utilisateur
-- =============================================
CREATE INDEX IF NOT EXISTS idx_resa_created_by_client
  ON restaurant_reservations(created_by_client_id, status);

-- =============================================
-- TASK_ASSIGNMENTS — historique par utilisateur trié par date
-- =============================================
CREATE INDEX IF NOT EXISTS idx_task_assignments_user_date
  ON task_assignments(user_id, assigned_at DESC);

-- =============================================
-- USER_SESSIONS — purge des sessions expirées par user
-- =============================================
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_expires
  ON user_sessions(user_id, expires_at);

-- =============================================
-- AI_IMPORTS — historique récent par applicant
-- =============================================
CREATE INDEX IF NOT EXISTS idx_ai_imports_applied_by
  ON ai_imports(applied_by, applied_at);

-- =============================================
-- CHANGELOG — feed récent par hôtel
-- =============================================
CREATE INDEX IF NOT EXISTS idx_changelog_hotel_created
  ON changelog(hotel_id, created_at DESC);

-- =============================================
-- ANALYZE — recalcule les stats SQLite après ajout d'index
-- =============================================
ANALYZE;
