-- ============================================
-- 0009 — Wikot : deux agents distincts (standard / max)
-- ============================================
-- Wikot       (mode='standard') : lecture + sourcing, accessible à tous
-- Wikot Max   (mode='max')      : rédaction + propositions de modif/création,
--                                 accessible uniquement aux éditeurs
-- Les conversations sont strictement isolées par mode.

ALTER TABLE wikot_conversations ADD COLUMN mode TEXT NOT NULL DEFAULT 'standard';

CREATE INDEX IF NOT EXISTS idx_wikot_conv_user_mode
  ON wikot_conversations(user_id, mode, is_archived, updated_at DESC);
