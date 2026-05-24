-- V17 : permet de lier une tache (template OU instance) a une procedure
-- existante du wiki. Quand l'utilisateur consulte la tache, il peut acceder
-- directement a la procedure detaillee a suivre.
-- ON DELETE SET NULL : si la procedure est supprimee, la tache n'est pas
-- supprimee, on perd juste le lien.

ALTER TABLE task_templates ADD COLUMN procedure_id INTEGER REFERENCES procedures(id) ON DELETE SET NULL;
ALTER TABLE task_instances ADD COLUMN procedure_id INTEGER REFERENCES procedures(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_task_templates_procedure ON task_templates(procedure_id);
CREATE INDEX IF NOT EXISTS idx_task_instances_procedure ON task_instances(procedure_id);
