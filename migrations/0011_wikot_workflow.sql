-- Migration 0011 : Back Wikot — workflow ultra-spécialisé en 4 modes
-- Ajoute le contexte d'une conversation Back Wikot : quel workflow (create_procedure /
-- update_procedure / create_info / update_info) et quelle cible (target_id) est
-- en cours d'édition. Permet de filtrer l'historique par utilisateur et par mode,
-- et de reprendre une conversation dans le bon contexte.

ALTER TABLE wikot_conversations ADD COLUMN workflow_mode TEXT;
ALTER TABLE wikot_conversations ADD COLUMN target_kind TEXT;
ALTER TABLE wikot_conversations ADD COLUMN target_id INTEGER;

-- Index : on requête souvent par user + workflow + récence
CREATE INDEX IF NOT EXISTS idx_wikot_conv_workflow
  ON wikot_conversations(user_id, workflow_mode, is_archived, updated_at DESC);

-- Index : reprise d'une conversation existante par cible (utile pour update_*)
CREATE INDEX IF NOT EXISTS idx_wikot_conv_target
  ON wikot_conversations(user_id, target_kind, target_id, updated_at DESC);
