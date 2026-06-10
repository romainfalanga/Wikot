-- ============================================
-- 0039 — Permission can_use_wikot + table task_skips
-- ============================================
--
-- 1) Permission can_use_wikot
--    Permission "ombrelle" pour l'administrateur côté page utilisateurs :
--    activer cette case donne accès à Wikot (l'agent IA) ET implique
--    automatiquement TOUTES les autres permissions granulaires
--    (procedures, info, chat, settings, tâches, véléda).
--    La logique "umbrella" est gérée côté code (front + back) :
--    on considère un user comme ayant la permission X dès lors qu'il
--    a can_use_wikot = 1 OU la permission X directement.
--
-- 2) Table task_skips
--    Quand un employé supprime une instance ponctuelle issue d'un template
--    récurrent, l'instance disparaissait... puis était immédiatement
--    re-générée par materializeTasksForDate au prochain refresh.
--    Pour éviter ça : on enregistre la paire (template_id, task_date)
--    dans task_skips. La fonction de matérialisation lit cette table
--    et ne recrée plus l'instance pour cette date.
-- ============================================

-- 1) Permission Wikot (ombrelle admin)
ALTER TABLE users ADD COLUMN can_use_wikot INTEGER NOT NULL DEFAULT 0;

-- Tous les admins existants reçoivent automatiquement cette permission
UPDATE users SET can_use_wikot = 1 WHERE role = 'admin';

-- 2) Table task_skips : marque les (template_id, task_date) à ne pas régénérer
CREATE TABLE IF NOT EXISTS task_skips (
  template_id INTEGER NOT NULL,
  task_date TEXT NOT NULL,
  hotel_id INTEGER NOT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (template_id, task_date),
  FOREIGN KEY (template_id) REFERENCES task_templates(id) ON DELETE CASCADE,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_task_skips_template_date
  ON task_skips(template_id, task_date);

CREATE INDEX IF NOT EXISTS idx_task_skips_hotel_date
  ON task_skips(hotel_id, task_date);
