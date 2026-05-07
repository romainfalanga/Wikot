-- ============================================
-- 0018 — Module "À faire" (tasks)
-- ============================================
-- Permissions granulaires :
--   - users.can_create_tasks  : créer / modifier / supprimer des tâches (templates + instances)
--   - users.can_assign_tasks  : attribuer les tâches du jour aux employés
-- (Voir et valider sa propre tâche assignée = par défaut pour tous, pas de permission requise)
--
-- Modèle de données :
--   - task_templates    : modèles récurrents (ex. "Vérifier la machine à café tous les matins")
--   - task_instances    : tâches concrètes pour une date donnée (récurrente OU ponctuelle)
--   - task_assignments  : qui doit faire quoi (un instance ↔ N users)
-- ============================================

-- 1) Permissions
ALTER TABLE users ADD COLUMN can_create_tasks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN can_assign_tasks INTEGER NOT NULL DEFAULT 0;

-- Tous les admins existants reçoivent automatiquement ces permissions
UPDATE users SET can_create_tasks = 1, can_assign_tasks = 1 WHERE role = 'admin';

-- 2) Templates de tâches (récurrentes)
CREATE TABLE IF NOT EXISTS task_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  -- Récurrence : bitmask des jours de semaine sur 7 bits.
  -- bit 0 = lundi, bit 1 = mardi, ..., bit 6 = dimanche.
  -- Ex : 127 = tous les jours, 31 = lun-ven, 96 = sam-dim, 1 = lundi seulement.
  recurrence_days INTEGER NOT NULL DEFAULT 127,
  -- Période de validité (optionnelle)
  active_from TEXT,         -- 'YYYY-MM-DD'
  active_to TEXT,           -- 'YYYY-MM-DD'
  -- Heure suggérée (optionnelle, info pour l'employé)
  suggested_time TEXT,      -- 'HH:MM'
  -- Catégorie (info, libre)
  category TEXT,            -- 'reception' | 'menage' | 'restaurant' | 'maintenance' | 'autre'
  -- Méta
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 3) Instances de tâches (concrètes, datées)
CREATE TABLE IF NOT EXISTS task_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  -- Si générée depuis un template, on garde la trace (peut être NULL pour les ponctuelles)
  template_id INTEGER,
  -- Date à laquelle la tâche doit être faite
  task_date TEXT NOT NULL,            -- 'YYYY-MM-DD'
  -- Snapshot des champs au moment de la génération
  -- (titre/description peuvent être édités sur l'instance sans toucher au template)
  title TEXT NOT NULL,
  description TEXT,
  suggested_time TEXT,
  category TEXT,
  -- État global de la tâche (utile si plusieurs assignés)
  -- 'pending' = en attente, 'in_progress' = au moins un assigné l'a démarrée,
  -- 'done' = tous les assignés ont validé (calculé), 'cancelled' = annulée
  status TEXT NOT NULL DEFAULT 'pending',
  -- Si la tâche n'est assignée à personne, elle reste visible et peut être prise par n'importe qui
  is_unassigned_visible INTEGER NOT NULL DEFAULT 1,
  -- Méta
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES task_templates(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Une instance ne peut être générée qu'une seule fois par template / par date
-- (évite les doublons en cas de re-génération de la journée)
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_instances_template_date
  ON task_instances(template_id, task_date)
  WHERE template_id IS NOT NULL;

-- 4) Assignments : qui doit faire quoi
CREATE TABLE IF NOT EXISTS task_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_instance_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  -- État individuel pour cet assigné
  -- 'pending' = pas encore fait, 'done' = validé
  status TEXT NOT NULL DEFAULT 'pending',
  completed_at DATETIME,
  notes TEXT,                          -- Note libre laissée par l'assigné lors de la validation
  assigned_by INTEGER,
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_instance_id) REFERENCES task_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_assignments_unique
  ON task_assignments(task_instance_id, user_id);

-- 5) Index perfs
CREATE INDEX IF NOT EXISTS idx_task_templates_hotel_active
  ON task_templates(hotel_id, is_active);

CREATE INDEX IF NOT EXISTS idx_task_instances_hotel_date
  ON task_instances(hotel_id, task_date);

CREATE INDEX IF NOT EXISTS idx_task_assignments_user_status
  ON task_assignments(user_id, status);

-- 6) Stockage de réservations restaurant pré-extraites par IA (pour la réconciliation client)
-- Optionnel pour cette migration : on persiste les imports IA pour Code Wikot et Restaurant
-- afin d'avoir un historique et de permettre le ré-import / annulation.
CREATE TABLE IF NOT EXISTS ai_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  import_type TEXT NOT NULL,           -- 'occupancy' | 'restaurant'
  source_filename TEXT,
  source_mime TEXT,
  raw_extraction TEXT,                 -- JSON brut renvoyé par Gemini
  applied_at DATETIME,                 -- NULL tant que non validé manuellement
  applied_by INTEGER,
  rows_count INTEGER DEFAULT 0,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE,
  FOREIGN KEY (applied_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_imports_hotel_type_date
  ON ai_imports(hotel_id, import_type, created_at DESC);
