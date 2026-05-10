-- ============================================
-- 0026 — Découplage tâche / personne
-- ============================================
-- Par défaut, une tâche récurrente ne pré-assigne plus automatiquement
-- ses employés à chaque occurrence. L'assignation se fait manuellement,
-- au coup par coup, quand le planning est connu.
--
-- La colonne `pre_assign` permet de garder le comportement legacy
-- (pré-assignation auto) si l'admin le souhaite explicitement.
-- ============================================

-- 1) Ajout colonne pre_assign sur task_templates (default 0 = OFF)
ALTER TABLE task_templates ADD COLUMN pre_assign INTEGER NOT NULL DEFAULT 0;

-- 2) Pour les modèles existants qui ont déjà des pré-assignés,
--    on active pre_assign=1 pour ne pas casser leur comportement actuel
UPDATE task_templates
SET pre_assign = 1
WHERE id IN (SELECT DISTINCT template_id FROM task_template_assignees);
