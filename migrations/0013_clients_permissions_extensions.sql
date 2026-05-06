-- ============================================
-- Migration 0013 : extensions clients + restaurant + permissions
-- ============================================
-- Complète la migration 0012 :
-- • Permissions granulaires staff : can_edit_clients, can_edit_restaurant
-- • hotels.client_login_code (code court tapé par le client à la connexion)
-- • hotels.* capacités par défaut petit-déj/déjeuner/dîner
-- • client_accounts.guest_name = mot de passe du jour (nom du client)
-- • restaurant_reservations.time_slot (créneau choisi)
-- • client_sessions : tokens client (expirent à 12h00 le lendemain de l'arrivée)

-- ============================================
-- 1. USERS : permissions clients + restaurant
-- ============================================
-- Ajout idempotent par check préalable impossible en SQL pur SQLite.
-- Les ALTER TABLE échouent si la colonne existe déjà → on les met dans une
-- migration séparée pour éviter de bloquer la migration entière.
-- Ici on protège chaque ALTER : si une colonne existe, on ignore (via try-catch
-- côté outil de migration). Wrangler n'a pas ce mécanisme : on assume colonnes
-- absentes (premier passage). Si tu rejoues, supprime les ALTER déjà appliqués.

ALTER TABLE users ADD COLUMN can_edit_clients INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN can_edit_restaurant INTEGER DEFAULT 0;

-- ============================================
-- 2. HOTELS : code de connexion client + capacités resto
-- ============================================
ALTER TABLE hotels ADD COLUMN client_login_code TEXT;
ALTER TABLE hotels ADD COLUMN breakfast_capacity INTEGER DEFAULT 30;
ALTER TABLE hotels ADD COLUMN lunch_capacity INTEGER DEFAULT 30;
ALTER TABLE hotels ADD COLUMN dinner_capacity INTEGER DEFAULT 30;

-- Génération automatique des codes pour les hôtels existants depuis le slug
UPDATE hotels SET client_login_code = UPPER(REPLACE(REPLACE(slug, '-', ''), ' ', '')) WHERE client_login_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hotels_client_code ON hotels(client_login_code) WHERE client_login_code IS NOT NULL;

-- ============================================
-- 3. RESTAURANT_RESERVATIONS : créneau horaire
-- ============================================
-- Champ time_slot ajouté pour permettre au client de choisir une heure (ex: '08:00').
-- NULL accepté pour la rétrocompatibilité.
ALTER TABLE restaurant_reservations ADD COLUMN time_slot TEXT;

-- ============================================
-- 4. CLIENT_SESSIONS : tokens client (expirent à midi)
-- ============================================
-- Un client se connecte → on crée une session avec un token aléatoire.
-- expires_at = lendemain 12h00 (après-midi du jour suivant l'arrivée),
-- mais en pratique la rotation à midi invalide aussi via reset des comptes.
CREATE TABLE IF NOT EXISTS client_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  client_account_id INTEGER NOT NULL,
  hotel_id INTEGER NOT NULL,
  room_id INTEGER NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_account_id) REFERENCES client_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id),
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);
CREATE INDEX IF NOT EXISTS idx_client_sessions_token ON client_sessions(token);
CREATE INDEX IF NOT EXISTS idx_client_sessions_account ON client_sessions(client_account_id, expires_at);

-- ============================================
-- 5. WIKOT_CONVERSATIONS : ajout mode 'concierge' (Front Wikot client)
-- ============================================
-- Le mode existe déjà (migration 0009). On ajoute juste un champ pour lier
-- une conversation à un client (au lieu d'un user staff).
ALTER TABLE wikot_conversations ADD COLUMN client_account_id INTEGER REFERENCES client_accounts(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_wikot_conv_client ON wikot_conversations(client_account_id, mode, is_archived, updated_at DESC);

-- ============================================
-- 6. ATTRIBUTION : seed initial pour les hôtels existants
-- ============================================
-- Crée des planning resto par défaut (tous les jours, 3 services ouverts) pour
-- chaque hôtel qui n'en a pas encore. Permet aux clients de réserver dès le départ.
-- On insère un par un (21 lignes par hôtel) pour éviter les compound SELECT.
-- Petit-déjeuner (7 jours)
INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
SELECT h.id, 0, 'breakfast', 1, '07:00', '10:30', h.breakfast_capacity FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM restaurant_schedule WHERE hotel_id = h.id AND weekday = 0 AND meal_type = 'breakfast');
INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
SELECT h.id, 1, 'breakfast', 1, '07:00', '10:30', h.breakfast_capacity FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM restaurant_schedule WHERE hotel_id = h.id AND weekday = 1 AND meal_type = 'breakfast');
INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
SELECT h.id, 2, 'breakfast', 1, '07:00', '10:30', h.breakfast_capacity FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM restaurant_schedule WHERE hotel_id = h.id AND weekday = 2 AND meal_type = 'breakfast');
INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
SELECT h.id, 3, 'breakfast', 1, '07:00', '10:30', h.breakfast_capacity FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM restaurant_schedule WHERE hotel_id = h.id AND weekday = 3 AND meal_type = 'breakfast');
INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
SELECT h.id, 4, 'breakfast', 1, '07:00', '10:30', h.breakfast_capacity FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM restaurant_schedule WHERE hotel_id = h.id AND weekday = 4 AND meal_type = 'breakfast');
INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
SELECT h.id, 5, 'breakfast', 1, '07:00', '10:30', h.breakfast_capacity FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM restaurant_schedule WHERE hotel_id = h.id AND weekday = 5 AND meal_type = 'breakfast');
INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
SELECT h.id, 6, 'breakfast', 1, '07:00', '10:30', h.breakfast_capacity FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM restaurant_schedule WHERE hotel_id = h.id AND weekday = 6 AND meal_type = 'breakfast');

-- Déjeuner (7 jours)
INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
SELECT h.id, 0, 'lunch', 1, '12:00', '14:00', h.lunch_capacity FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM restaurant_schedule WHERE hotel_id = h.id AND weekday = 0 AND meal_type = 'lunch');
INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
SELECT h.id, 1, 'lunch', 1, '12:00', '14:00', h.lunch_capacity FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM restaurant_schedule WHERE hotel_id = h.id AND weekday = 1 AND meal_type = 'lunch');
INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
SELECT h.id, 2, 'lunch', 1, '12:00', '14:00', h.lunch_capacity FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM restaurant_schedule WHERE hotel_id = h.id AND weekday = 2 AND meal_type = 'lunch');
INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
SELECT h.id, 3, 'lunch', 1, '12:00', '14:00', h.lunch_capacity FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM restaurant_schedule WHERE hotel_id = h.id AND weekday = 3 AND meal_type = 'lunch');
INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
SELECT h.id, 4, 'lunch', 1, '12:00', '14:00', h.lunch_capacity FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM restaurant_schedule WHERE hotel_id = h.id AND weekday = 4 AND meal_type = 'lunch');
INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
SELECT h.id, 5, 'lunch', 1, '12:00', '14:00', h.lunch_capacity FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM restaurant_schedule WHERE hotel_id = h.id AND weekday = 5 AND meal_type = 'lunch');
INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
SELECT h.id, 6, 'lunch', 1, '12:00', '14:00', h.lunch_capacity FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM restaurant_schedule WHERE hotel_id = h.id AND weekday = 6 AND meal_type = 'lunch');

-- Dîner (7 jours)
INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
SELECT h.id, 0, 'dinner', 1, '19:00', '22:00', h.dinner_capacity FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM restaurant_schedule WHERE hotel_id = h.id AND weekday = 0 AND meal_type = 'dinner');
INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
SELECT h.id, 1, 'dinner', 1, '19:00', '22:00', h.dinner_capacity FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM restaurant_schedule WHERE hotel_id = h.id AND weekday = 1 AND meal_type = 'dinner');
INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
SELECT h.id, 2, 'dinner', 1, '19:00', '22:00', h.dinner_capacity FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM restaurant_schedule WHERE hotel_id = h.id AND weekday = 2 AND meal_type = 'dinner');
INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
SELECT h.id, 3, 'dinner', 1, '19:00', '22:00', h.dinner_capacity FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM restaurant_schedule WHERE hotel_id = h.id AND weekday = 3 AND meal_type = 'dinner');
INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
SELECT h.id, 4, 'dinner', 1, '19:00', '22:00', h.dinner_capacity FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM restaurant_schedule WHERE hotel_id = h.id AND weekday = 4 AND meal_type = 'dinner');
INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
SELECT h.id, 5, 'dinner', 1, '19:00', '22:00', h.dinner_capacity FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM restaurant_schedule WHERE hotel_id = h.id AND weekday = 5 AND meal_type = 'dinner');
INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
SELECT h.id, 6, 'dinner', 1, '19:00', '22:00', h.dinner_capacity FROM hotels h
WHERE NOT EXISTS (SELECT 1 FROM restaurant_schedule WHERE hotel_id = h.id AND weekday = 6 AND meal_type = 'dinner');
