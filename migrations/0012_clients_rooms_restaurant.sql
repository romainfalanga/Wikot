-- ============================================
-- Migration 0012 : comptes clients + chambres + restaurant
-- ============================================
-- IDEMPOTENTE : peut être rejouée sans casser la base.
-- Les ALTER TABLE sont protégés par des SELECT conditionnels en SQL pur impossibles
-- en SQLite, donc on isole les ALTER dans une migration séparée 0012b si besoin.
-- Ici on ne met que des CREATE TABLE IF NOT EXISTS et CREATE INDEX IF NOT EXISTS.

-- ============================================
-- 1. ROOMS : chambres de chaque hôtel
-- ============================================
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  room_number TEXT NOT NULL,
  floor TEXT,
  capacity INTEGER DEFAULT 2,
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hotel_id, room_number),
  FOREIGN KEY (hotel_id) REFERENCES hotels(id)
);
CREATE INDEX IF NOT EXISTS idx_rooms_hotel ON rooms(hotel_id, is_active, sort_order);

-- ============================================
-- 2. CLIENT_ACCOUNTS : comptes clients (séparés des users staff)
-- ============================================
CREATE TABLE IF NOT EXISTS client_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  room_id INTEGER NOT NULL,
  guest_name TEXT,
  guest_name_normalized TEXT,
  checkout_date DATE,
  session_valid_until DATETIME,
  is_active INTEGER DEFAULT 0,
  last_login DATETIME,
  rotation_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hotel_id, room_id),
  FOREIGN KEY (hotel_id) REFERENCES hotels(id),
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);
CREATE INDEX IF NOT EXISTS idx_client_accounts_hotel ON client_accounts(hotel_id, is_active);
CREATE INDEX IF NOT EXISTS idx_client_accounts_lookup ON client_accounts(hotel_id, room_id, guest_name_normalized);

-- ============================================
-- 3. ROOM_OCCUPANCY : journal des rotations
-- ============================================
CREATE TABLE IF NOT EXISTS room_occupancy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  room_id INTEGER NOT NULL,
  occupancy_date DATE NOT NULL,
  guest_name TEXT NOT NULL,
  guest_name_normalized TEXT NOT NULL,
  checkout_date DATE NOT NULL,
  created_by INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id),
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_occupancy_hotel_date ON room_occupancy(hotel_id, occupancy_date);
CREATE INDEX IF NOT EXISTS idx_occupancy_room_date ON room_occupancy(room_id, occupancy_date);

-- ============================================
-- 4. RESTAURANT_SCHEDULE : planning hebdo
-- ============================================
CREATE TABLE IF NOT EXISTS restaurant_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  weekday INTEGER NOT NULL,
  meal_type TEXT NOT NULL CHECK(meal_type IN ('breakfast', 'lunch', 'dinner')),
  is_open INTEGER DEFAULT 1,
  open_time TEXT,
  close_time TEXT,
  capacity INTEGER DEFAULT 30,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hotel_id, weekday, meal_type),
  FOREIGN KEY (hotel_id) REFERENCES hotels(id)
);
CREATE INDEX IF NOT EXISTS idx_schedule_hotel ON restaurant_schedule(hotel_id, weekday, meal_type);

-- ============================================
-- 5. RESTAURANT_EXCEPTIONS : exceptions ponctuelles
-- ============================================
CREATE TABLE IF NOT EXISTS restaurant_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  exception_date DATE NOT NULL,
  meal_type TEXT NOT NULL CHECK(meal_type IN ('breakfast', 'lunch', 'dinner')),
  is_open INTEGER DEFAULT 0,
  open_time TEXT,
  close_time TEXT,
  capacity INTEGER,
  notes TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hotel_id, exception_date, meal_type),
  FOREIGN KEY (hotel_id) REFERENCES hotels(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_exceptions_hotel_date ON restaurant_exceptions(hotel_id, exception_date);

-- ============================================
-- 6. RESTAURANT_RESERVATIONS : réservations
-- ============================================
CREATE TABLE IF NOT EXISTS restaurant_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  room_id INTEGER,
  reservation_date DATE NOT NULL,
  meal_type TEXT NOT NULL CHECK(meal_type IN ('breakfast', 'lunch', 'dinner')),
  guest_count INTEGER NOT NULL DEFAULT 1,
  guest_name TEXT,
  notes TEXT,
  status TEXT DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'cancelled')),
  created_by_user_id INTEGER,
  created_by_client_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id),
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  FOREIGN KEY (created_by_client_id) REFERENCES client_accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_resa_hotel_date ON restaurant_reservations(hotel_id, reservation_date, meal_type, status);
CREATE INDEX IF NOT EXISTS idx_resa_room ON restaurant_reservations(room_id, reservation_date) WHERE room_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_resa_client ON restaurant_reservations(created_by_client_id, status) WHERE created_by_client_id IS NOT NULL;
