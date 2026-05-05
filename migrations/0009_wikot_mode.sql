-- ============================================
-- 0009 — Mode sur les conversations Wikot
-- ============================================
-- Distinction Wikot (lecture/sourcing) vs Wikot Max (rédaction/création/modification)
-- Les deux agents ont leurs propres conversations isolées par 'mode'.

ALTER TABLE wikot_conversations ADD COLUMN mode TEXT DEFAULT 'standard';

-- Index pour filtrer rapidement les conversations par mode et par user
CREATE INDEX IF NOT EXISTS idx_wikot_conv_user_mode ON wikot_conversations(user_id, mode, is_archived, updated_at DESC);

-- Toutes les conversations existantes restent en mode 'standard' (Wikot classique)
UPDATE wikot_conversations SET mode = 'standard' WHERE mode IS NULL;
