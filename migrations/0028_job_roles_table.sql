-- 0028 — Rôles métiers dynamiques par hôtel
-- ============================================
-- Avant : les job_role étaient une liste codée en dur dans le backend
-- ('reception', 'serveur', 'cuisinier', 'housekeeping', 'maintenance', 'manager', 'autre')
-- Désormais : table par hôtel, gérable par les admins (CRUD).
-- users.job_role reste un TEXT (slug du rôle) pour rester rétro-compatible
-- avec les requêtes existantes (pas de FK stricte pour ne pas bloquer en cas
-- de suppression).

CREATE TABLE IF NOT EXISTS job_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,           -- ex: 'reception', 'serveur', stocké aussi dans users.job_role
  name TEXT NOT NULL,           -- label affiché : ex 'Réception', 'Serveur·euse'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hotel_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_job_roles_hotel ON job_roles(hotel_id);

-- Seed : pour chaque hôtel existant, on crée les 7 rôles historiques
INSERT INTO job_roles (hotel_id, slug, name)
SELECT h.id, 'reception', 'Réception' FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM job_roles jr WHERE jr.hotel_id = h.id AND jr.slug = 'reception');

INSERT INTO job_roles (hotel_id, slug, name)
SELECT h.id, 'serveur', 'Serveur·euse' FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM job_roles jr WHERE jr.hotel_id = h.id AND jr.slug = 'serveur');

INSERT INTO job_roles (hotel_id, slug, name)
SELECT h.id, 'cuisinier', 'Cuisinier·ière' FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM job_roles jr WHERE jr.hotel_id = h.id AND jr.slug = 'cuisinier');

INSERT INTO job_roles (hotel_id, slug, name)
SELECT h.id, 'housekeeping', 'Housekeeping' FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM job_roles jr WHERE jr.hotel_id = h.id AND jr.slug = 'housekeeping');

INSERT INTO job_roles (hotel_id, slug, name)
SELECT h.id, 'maintenance', 'Maintenance' FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM job_roles jr WHERE jr.hotel_id = h.id AND jr.slug = 'maintenance');

INSERT INTO job_roles (hotel_id, slug, name)
SELECT h.id, 'manager', 'Manager' FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM job_roles jr WHERE jr.hotel_id = h.id AND jr.slug = 'manager');

INSERT INTO job_roles (hotel_id, slug, name)
SELECT h.id, 'autre', 'Autre' FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM job_roles jr WHERE jr.hotel_id = h.id AND jr.slug = 'autre');
