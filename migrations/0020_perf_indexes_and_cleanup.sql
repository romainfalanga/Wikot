-- ============================================
-- 0020 — Optimisations perf + scalabilité
-- ============================================
-- Objectifs :
--   1) Ajouter les index manquants identifiés lors de l'audit (FK, lookups fréquents).
--   2) Nettoyer les sessions expirées (croissance infinie sinon).
--   3) Préparer le terrain pour la pagination des conversations Wikot.
-- ============================================

-- 1) Index manquants sur les FK / lookups fréquents
--    (CREATE INDEX IF NOT EXISTS = idempotent, safe à rejouer)

-- Tâches : accélère la materialisation et les jointures
CREATE INDEX IF NOT EXISTS idx_task_instances_template_id
  ON task_instances(template_id) WHERE template_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_assignments_instance
  ON task_assignments(task_instance_id);

-- AI imports : retrouver vite les imports d'un hôtel par type & date
CREATE INDEX IF NOT EXISTS idx_ai_imports_hotel_type
  ON ai_imports(hotel_id, import_type, created_at DESC);

-- Audit / lookups fréquents sur sessions actives
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
  ON user_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_client_sessions_expires
  ON client_sessions(expires_at);

-- Conversations Wikot : filtrage rapide par hotel + pagination
-- (utile pour les futures listes paginées + dashboard admin)
CREATE INDEX IF NOT EXISTS idx_wikot_conv_updated
  ON wikot_conversations(updated_at DESC);

-- Restaurant : lookup réservations par client account (existait WHERE-partial, on garantit)
CREATE INDEX IF NOT EXISTS idx_resa_hotel_status_date
  ON restaurant_reservations(hotel_id, status, reservation_date);

-- Chat : index composé pour overview/unread (JOIN intensif)
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_id_desc
  ON chat_messages(channel_id, id DESC);

-- 2) Nettoyage des sessions expirées
--    On purge tout ce qui est > expires_at à l'application de la migration.
--    Le runtime fait déjà un cleanup ponctuel, mais cette purge évite les "stocks" historiques.
DELETE FROM user_sessions   WHERE expires_at < CURRENT_TIMESTAMP;
DELETE FROM client_sessions WHERE expires_at < CURRENT_TIMESTAMP;

-- 3) Hygiène : on supprime les wikot_conversations vides + leurs messages orphelins
--    (cas typique : conversation créée puis abandonnée sans message)
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
