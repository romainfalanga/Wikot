-- ============================================
-- 0004 — Hotel Info + Refactor Procédures
-- ============================================

-- Table catégories d'informations hôtel
CREATE TABLE IF NOT EXISTS hotel_info_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  icon TEXT DEFAULT 'fa-circle-info',
  color TEXT DEFAULT '#3B82F6',
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_hotel_info_categories_hotel ON hotel_info_categories(hotel_id);

-- Table items d'informations hôtel
CREATE TABLE IF NOT EXISTS hotel_info_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  category_id INTEGER,
  title TEXT NOT NULL,
  content TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES hotel_info_categories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_hotel_info_items_hotel ON hotel_info_items(hotel_id);
CREATE INDEX IF NOT EXISTS idx_hotel_info_items_category ON hotel_info_items(category_id);

-- Refactor procédures : fusionner description + details + warning + tip dans un champ "content"
-- On garde les anciens champs pour ne rien casser, mais on ajoute "content" qui sera utilisé désormais
ALTER TABLE steps ADD COLUMN content TEXT;
ALTER TABLE steps ADD COLUMN linked_procedure_id INTEGER REFERENCES procedures(id) ON DELETE SET NULL;

-- Migration des données existantes : on concatène description + details + warning + tip dans content
UPDATE steps SET content = TRIM(
  COALESCE(description, '') ||
  CASE WHEN details IS NOT NULL AND details != '' THEN
    CASE WHEN description IS NOT NULL AND description != '' THEN char(10) || char(10) ELSE '' END || details
  ELSE '' END ||
  CASE WHEN warning IS NOT NULL AND warning != '' THEN char(10) || char(10) || '⚠️ ' || warning ELSE '' END ||
  CASE WHEN tip IS NOT NULL AND tip != '' THEN char(10) || char(10) || '💡 ' || tip ELSE '' END
) WHERE content IS NULL;

-- Idem pour les condition_steps : fusion description + details + warning + tip
ALTER TABLE condition_steps ADD COLUMN content TEXT;
ALTER TABLE condition_steps ADD COLUMN linked_procedure_id INTEGER REFERENCES procedures(id) ON DELETE SET NULL;
UPDATE condition_steps SET content = TRIM(
  COALESCE(description, '') ||
  CASE WHEN details IS NOT NULL AND details != '' THEN
    CASE WHEN description IS NOT NULL AND description != '' THEN char(10) || char(10) ELSE '' END || details
  ELSE '' END ||
  CASE WHEN warning IS NOT NULL AND warning != '' THEN char(10) || char(10) || '⚠️ ' || warning ELSE '' END ||
  CASE WHEN tip IS NOT NULL AND tip != '' THEN char(10) || char(10) || '💡 ' || tip ELSE '' END
) WHERE content IS NULL;
