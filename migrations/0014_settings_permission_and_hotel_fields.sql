-- ============================================
-- 0014 — Permission can_edit_settings + enrichissement hôtels
-- ============================================
-- Ajoute :
--   - users.can_edit_settings : permission granulaire pour modifier les paramètres hôtel
--   - hotels : phone, email, website, currency, timezone, language,
--              checkin_time, checkout_time, wifi_ssid, wifi_password,
--              welcome_message, cancellation_policy,
--              instagram_url, facebook_url, tripadvisor_url, booking_url,
--              brand_color, description
-- + Index utiles pour les performances
-- ============================================

-- 1) Permission settings (granulaire pour les employés)
ALTER TABLE users ADD COLUMN can_edit_settings INTEGER NOT NULL DEFAULT 0;

-- Tous les admins existants reçoivent automatiquement le droit
UPDATE users SET can_edit_settings = 1 WHERE role = 'admin';

-- 2) Identité enrichie
ALTER TABLE hotels ADD COLUMN description TEXT;
ALTER TABLE hotels ADD COLUMN brand_color TEXT DEFAULT '#f59e0b';
ALTER TABLE hotels ADD COLUMN currency TEXT DEFAULT 'EUR';
ALTER TABLE hotels ADD COLUMN timezone TEXT DEFAULT 'Europe/Paris';
ALTER TABLE hotels ADD COLUMN language TEXT DEFAULT 'fr';

-- 3) Contact
ALTER TABLE hotels ADD COLUMN phone TEXT;
ALTER TABLE hotels ADD COLUMN email TEXT;
ALTER TABLE hotels ADD COLUMN website TEXT;
ALTER TABLE hotels ADD COLUMN instagram_url TEXT;
ALTER TABLE hotels ADD COLUMN facebook_url TEXT;
ALTER TABLE hotels ADD COLUMN tripadvisor_url TEXT;
ALTER TABLE hotels ADD COLUMN booking_url TEXT;

-- 4) Séjour
ALTER TABLE hotels ADD COLUMN checkin_time TEXT DEFAULT '15:00';
ALTER TABLE hotels ADD COLUMN checkout_time TEXT DEFAULT '12:00';
ALTER TABLE hotels ADD COLUMN cancellation_policy TEXT;
ALTER TABLE hotels ADD COLUMN welcome_message TEXT;

-- 5) Wifi
ALTER TABLE hotels ADD COLUMN wifi_ssid TEXT;
ALTER TABLE hotels ADD COLUMN wifi_password TEXT;
ALTER TABLE hotels ADD COLUMN wifi_instructions TEXT;

-- 6) Index perf
CREATE INDEX IF NOT EXISTS idx_wikot_messages_conv_created
  ON wikot_messages(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_sessions_token
  ON client_sessions(token);

CREATE INDEX IF NOT EXISTS idx_room_occupancy_hotel_date_room
  ON room_occupancy(hotel_id, occupancy_date, room_id);

CREATE INDEX IF NOT EXISTS idx_rooms_hotel_active_sort
  ON rooms(hotel_id, is_active, sort_order);
