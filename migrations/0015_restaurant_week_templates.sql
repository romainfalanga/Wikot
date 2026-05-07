-- ============================================
-- 0015 : Restaurant Week Templates
-- Templates de planning hebdomadaire restaurant.
-- Chaque template contient 21 entrées (7 jours x 3 services) sérialisées en JSON.
-- ============================================

CREATE TABLE IF NOT EXISTS restaurant_week_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_default INTEGER DEFAULT 0,
  -- days_json structure :
  -- [{ "weekday":0, "breakfast":{is_open,open_time,close_time,capacity}, "lunch":{...}, "dinner":{...} }, ...]
  days_json TEXT NOT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_week_templates_hotel ON restaurant_week_templates(hotel_id);

-- ============================================
-- Seed pour Grand Hôtel des Lecques (hotel_id = 1) : 3 templates de base
-- ============================================

-- Template "Semaine standard" : tous les jours ouverts, créneaux classiques
INSERT INTO restaurant_week_templates (hotel_id, name, description, is_default, days_json)
SELECT 1, 'Semaine standard', 'Tous les jours ouverts. Petit-déj 7h-10h30, déjeuner 12h-14h, dîner 19h-22h.', 1,
  '[' ||
  '{"weekday":0,"breakfast":{"is_open":1,"open_time":"07:30","close_time":"10:30","capacity":40},"lunch":{"is_open":1,"open_time":"12:00","close_time":"14:00","capacity":35},"dinner":{"is_open":1,"open_time":"19:00","close_time":"22:00","capacity":40}},' ||
  '{"weekday":1,"breakfast":{"is_open":1,"open_time":"07:00","close_time":"10:30","capacity":40},"lunch":{"is_open":1,"open_time":"12:00","close_time":"14:00","capacity":35},"dinner":{"is_open":1,"open_time":"19:00","close_time":"22:00","capacity":40}},' ||
  '{"weekday":2,"breakfast":{"is_open":1,"open_time":"07:00","close_time":"10:30","capacity":40},"lunch":{"is_open":1,"open_time":"12:00","close_time":"14:00","capacity":35},"dinner":{"is_open":1,"open_time":"19:00","close_time":"22:00","capacity":40}},' ||
  '{"weekday":3,"breakfast":{"is_open":1,"open_time":"07:00","close_time":"10:30","capacity":40},"lunch":{"is_open":1,"open_time":"12:00","close_time":"14:00","capacity":35},"dinner":{"is_open":1,"open_time":"19:00","close_time":"22:00","capacity":40}},' ||
  '{"weekday":4,"breakfast":{"is_open":1,"open_time":"07:00","close_time":"10:30","capacity":40},"lunch":{"is_open":1,"open_time":"12:00","close_time":"14:00","capacity":35},"dinner":{"is_open":1,"open_time":"19:00","close_time":"22:30","capacity":45}},' ||
  '{"weekday":5,"breakfast":{"is_open":1,"open_time":"07:30","close_time":"11:00","capacity":50},"lunch":{"is_open":1,"open_time":"12:00","close_time":"14:30","capacity":45},"dinner":{"is_open":1,"open_time":"19:00","close_time":"22:30","capacity":50}},' ||
  '{"weekday":6,"breakfast":{"is_open":1,"open_time":"07:30","close_time":"11:00","capacity":50},"lunch":{"is_open":1,"open_time":"12:00","close_time":"14:30","capacity":45},"dinner":{"is_open":0,"open_time":"19:00","close_time":"22:00","capacity":40}}' ||
  ']'
WHERE NOT EXISTS (SELECT 1 FROM restaurant_week_templates WHERE hotel_id = 1 AND name = 'Semaine standard');

-- Template "Semaine été" : capacités étendues, horaires plus larges
INSERT INTO restaurant_week_templates (hotel_id, name, description, is_default, days_json)
SELECT 1, 'Semaine été', 'Forte affluence : capacités élargies, services plus longs, terrasse ouverte tous les soirs.', 0,
  '[' ||
  '{"weekday":0,"breakfast":{"is_open":1,"open_time":"07:00","close_time":"11:00","capacity":60},"lunch":{"is_open":1,"open_time":"12:00","close_time":"14:30","capacity":50},"dinner":{"is_open":1,"open_time":"19:00","close_time":"22:30","capacity":60}},' ||
  '{"weekday":1,"breakfast":{"is_open":1,"open_time":"07:00","close_time":"10:30","capacity":60},"lunch":{"is_open":1,"open_time":"12:00","close_time":"14:30","capacity":50},"dinner":{"is_open":1,"open_time":"19:00","close_time":"22:30","capacity":60}},' ||
  '{"weekday":2,"breakfast":{"is_open":1,"open_time":"07:00","close_time":"10:30","capacity":60},"lunch":{"is_open":1,"open_time":"12:00","close_time":"14:30","capacity":50},"dinner":{"is_open":1,"open_time":"19:00","close_time":"22:30","capacity":60}},' ||
  '{"weekday":3,"breakfast":{"is_open":1,"open_time":"07:00","close_time":"10:30","capacity":60},"lunch":{"is_open":1,"open_time":"12:00","close_time":"14:30","capacity":50},"dinner":{"is_open":1,"open_time":"19:00","close_time":"22:30","capacity":60}},' ||
  '{"weekday":4,"breakfast":{"is_open":1,"open_time":"07:00","close_time":"10:30","capacity":60},"lunch":{"is_open":1,"open_time":"12:00","close_time":"14:30","capacity":50},"dinner":{"is_open":1,"open_time":"19:00","close_time":"23:00","capacity":65}},' ||
  '{"weekday":5,"breakfast":{"is_open":1,"open_time":"07:00","close_time":"11:00","capacity":70},"lunch":{"is_open":1,"open_time":"12:00","close_time":"15:00","capacity":60},"dinner":{"is_open":1,"open_time":"19:00","close_time":"23:00","capacity":70}},' ||
  '{"weekday":6,"breakfast":{"is_open":1,"open_time":"07:30","close_time":"11:00","capacity":70},"lunch":{"is_open":1,"open_time":"12:00","close_time":"15:00","capacity":60},"dinner":{"is_open":1,"open_time":"19:00","close_time":"22:30","capacity":60}}' ||
  ']'
WHERE NOT EXISTS (SELECT 1 FROM restaurant_week_templates WHERE hotel_id = 1 AND name = 'Semaine été');

-- Template "Semaine fermeture" : tout fermé
INSERT INTO restaurant_week_templates (hotel_id, name, description, is_default, days_json)
SELECT 1, 'Semaine fermeture', 'Tous les services fermés (congés / travaux).', 0,
  '[' ||
  '{"weekday":0,"breakfast":{"is_open":0,"open_time":"07:00","close_time":"10:30","capacity":0},"lunch":{"is_open":0,"open_time":"12:00","close_time":"14:00","capacity":0},"dinner":{"is_open":0,"open_time":"19:00","close_time":"22:00","capacity":0}},' ||
  '{"weekday":1,"breakfast":{"is_open":0,"open_time":"07:00","close_time":"10:30","capacity":0},"lunch":{"is_open":0,"open_time":"12:00","close_time":"14:00","capacity":0},"dinner":{"is_open":0,"open_time":"19:00","close_time":"22:00","capacity":0}},' ||
  '{"weekday":2,"breakfast":{"is_open":0,"open_time":"07:00","close_time":"10:30","capacity":0},"lunch":{"is_open":0,"open_time":"12:00","close_time":"14:00","capacity":0},"dinner":{"is_open":0,"open_time":"19:00","close_time":"22:00","capacity":0}},' ||
  '{"weekday":3,"breakfast":{"is_open":0,"open_time":"07:00","close_time":"10:30","capacity":0},"lunch":{"is_open":0,"open_time":"12:00","close_time":"14:00","capacity":0},"dinner":{"is_open":0,"open_time":"19:00","close_time":"22:00","capacity":0}},' ||
  '{"weekday":4,"breakfast":{"is_open":0,"open_time":"07:00","close_time":"10:30","capacity":0},"lunch":{"is_open":0,"open_time":"12:00","close_time":"14:00","capacity":0},"dinner":{"is_open":0,"open_time":"19:00","close_time":"22:00","capacity":0}},' ||
  '{"weekday":5,"breakfast":{"is_open":0,"open_time":"07:00","close_time":"10:30","capacity":0},"lunch":{"is_open":0,"open_time":"12:00","close_time":"14:00","capacity":0},"dinner":{"is_open":0,"open_time":"19:00","close_time":"22:00","capacity":0}},' ||
  '{"weekday":6,"breakfast":{"is_open":0,"open_time":"07:00","close_time":"10:30","capacity":0},"lunch":{"is_open":0,"open_time":"12:00","close_time":"14:00","capacity":0},"dinner":{"is_open":0,"open_time":"19:00","close_time":"22:00","capacity":0}}' ||
  ']'
WHERE NOT EXISTS (SELECT 1 FROM restaurant_week_templates WHERE hotel_id = 1 AND name = 'Semaine fermeture');
