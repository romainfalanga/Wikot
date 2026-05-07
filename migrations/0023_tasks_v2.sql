-- ============================================
-- 0023 — Module "À faire" v2 : récurrence enrichie + pré-assignation + priorité
-- ============================================

-- 1) Enrichissement task_templates
ALTER TABLE task_templates ADD COLUMN recurrence_type TEXT NOT NULL DEFAULT 'weekly';
ALTER TABLE task_templates ADD COLUMN monthly_day INTEGER;
ALTER TABLE task_templates ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE task_templates ADD COLUMN duration_min INTEGER;

UPDATE task_templates SET recurrence_type = 'daily' WHERE recurrence_days = 127;

-- 2) Enrichissement task_instances
ALTER TABLE task_instances ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE task_instances ADD COLUMN duration_min INTEGER;

-- 3) Pré-assignation sur template
CREATE TABLE IF NOT EXISTS task_template_assignees (
  template_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (template_id, user_id),
  FOREIGN KEY (template_id) REFERENCES task_templates(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_template_assignees_user
  ON task_template_assignees(user_id);

-- 4) Index utiles pour la vue semaine
CREATE INDEX IF NOT EXISTS idx_task_instances_hotel_date_status
  ON task_instances(hotel_id, task_date, status);
