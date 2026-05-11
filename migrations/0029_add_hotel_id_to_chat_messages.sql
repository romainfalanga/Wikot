-- ============================================
-- Bug critique : chat_messages.hotel_id manquant
-- Le worker faisait des WHERE m.hotel_id = ? qui plantaient en silence,
-- cassant la recherche globale, Wikot search_messages, et tous les shortcuts
-- conversations de l'expert IA.
-- ============================================

-- Ajouter la colonne (nullable d'abord pour permettre le backfill)
ALTER TABLE chat_messages ADD COLUMN hotel_id INTEGER;

-- Backfill : récupérer hotel_id depuis chat_channels
UPDATE chat_messages
SET hotel_id = (
  SELECT c.hotel_id FROM chat_channels c WHERE c.id = chat_messages.channel_id
)
WHERE hotel_id IS NULL;

-- Index pour les requêtes WHERE m.hotel_id = ?
CREATE INDEX IF NOT EXISTS idx_chat_messages_hotel ON chat_messages(hotel_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_hotel_created ON chat_messages(hotel_id, created_at DESC);
