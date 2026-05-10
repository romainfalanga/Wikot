-- ============================================
-- 0027 — Suppression définitive de la pré-assignation au niveau template
-- ============================================
-- Décision : une tâche récurrente = un MODÈLE (mère) qui définit QUOI/QUAND/OÙ.
-- Chaque jour génère une INSTANCE (bébé) qui naît TOUJOURS libre.
-- L'attribution se fait UNIQUEMENT au niveau instance (jour précis).
-- Une attribution sur un jour n'affecte aucun autre jour.
-- ============================================

-- 1) Drop de la table task_template_assignees (plus utilisée)
DROP TABLE IF EXISTS task_template_assignees;

-- 2) Drop de la colonne pre_assign sur task_templates
--    SQLite supporte ALTER TABLE DROP COLUMN depuis la 3.35 (D1 supporte)
ALTER TABLE task_templates DROP COLUMN pre_assign;
