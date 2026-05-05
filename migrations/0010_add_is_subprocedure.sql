-- ============================================
-- 0010 — Flag explicite is_subprocedure sur procedures
-- ============================================
-- Avant : on déduisait dynamiquement si une procédure était une sous-procédure
-- en regardant si elle était référencée via steps.linked_procedure_id par une
-- AUTRE procédure du même hôtel. Fragile : si l'étape parent perd son
-- linked_procedure_id (modif via Back Wikot ou modal), la sous-procédure
-- redevenait visible comme procédure principale.
--
-- Maintenant : flag explicite is_subprocedure (0/1) stocké en base.
-- - Création depuis le modal "ajouter une sous-procédure" → is_subprocedure=1
-- - À chaque POST/PUT d'une procédure parent, on synchronise les enfants :
--   les procédures référencées via linked_procedure_id sont marquées en sous.
-- - GET /api/procedures filtre simplement WHERE is_subprocedure = 0.
-- ============================================

ALTER TABLE procedures ADD COLUMN is_subprocedure INTEGER NOT NULL DEFAULT 0;

-- Backfill : toute procédure actuellement référencée comme linked_procedure_id
-- par une étape (steps ou condition_steps) d'une AUTRE procédure du même hôtel
-- est marquée comme sous-procédure.
UPDATE procedures
SET is_subprocedure = 1
WHERE id IN (
  SELECT DISTINCT s.linked_procedure_id
  FROM steps s
  JOIN procedures parent ON parent.id = s.procedure_id
  JOIN procedures child  ON child.id  = s.linked_procedure_id
  WHERE s.linked_procedure_id IS NOT NULL
    AND parent.hotel_id = child.hotel_id
    AND parent.id <> child.id
)
OR id IN (
  SELECT DISTINCT cs.linked_procedure_id
  FROM condition_steps cs
  JOIN conditions cd ON cd.id = cs.condition_id
  JOIN procedures parent ON parent.id = cd.procedure_id
  JOIN procedures child  ON child.id  = cs.linked_procedure_id
  WHERE cs.linked_procedure_id IS NOT NULL
    AND parent.hotel_id = child.hotel_id
    AND parent.id <> child.id
);

-- Index pour accélérer le filtrage liste
CREATE INDEX IF NOT EXISTS idx_procedures_is_subprocedure
  ON procedures(hotel_id, is_subprocedure);
