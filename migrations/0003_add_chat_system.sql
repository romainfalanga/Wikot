-- ============================================
-- WIKOT - Chat / Conversations System
-- Adds: chat_groups, chat_channels, chat_messages, chat_reads
-- ============================================

-- Groupes de salons (ex: Espaces communs, Chambres, Opérationnel)
CREATE TABLE IF NOT EXISTS chat_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  icon TEXT DEFAULT 'fa-folder',
  color TEXT DEFAULT '#3B82F6',
  sort_order INTEGER DEFAULT 0,
  is_system INTEGER DEFAULT 0, -- 1 = groupe par défaut (non supprimable)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id)
);

-- Salons de conversation (rattachés à un groupe)
CREATE TABLE IF NOT EXISTS chat_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT 'fa-hashtag',
  sort_order INTEGER DEFAULT 0,
  is_archived INTEGER DEFAULT 0,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id),
  FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Messages dans les salons (pas de suppression)
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  edited_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_id) REFERENCES chat_channels(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- État de lecture par utilisateur/salon
CREATE TABLE IF NOT EXISTS chat_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  channel_id INTEGER NOT NULL,
  last_read_message_id INTEGER DEFAULT 0,
  last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (channel_id) REFERENCES chat_channels(id) ON DELETE CASCADE,
  UNIQUE(user_id, channel_id)
);

-- Indexes pour performance
CREATE INDEX IF NOT EXISTS idx_chat_groups_hotel ON chat_groups(hotel_id);
CREATE INDEX IF NOT EXISTS idx_chat_channels_hotel ON chat_channels(hotel_id);
CREATE INDEX IF NOT EXISTS idx_chat_channels_group ON chat_channels(group_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_reads_user ON chat_reads(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_reads_channel ON chat_reads(channel_id);

-- ============================================
-- Seed : créer les groupes et salons par défaut pour TOUS les hôtels existants
-- ============================================

-- Groupe 1 : Espaces communs
INSERT INTO chat_groups (hotel_id, name, icon, color, sort_order, is_system)
SELECT id, 'Espaces communs', 'fa-building', '#3B82F6', 1, 1 FROM hotels
WHERE NOT EXISTS (SELECT 1 FROM chat_groups WHERE hotel_id = hotels.id AND name = 'Espaces communs');

-- Groupe 2 : Chambres
INSERT INTO chat_groups (hotel_id, name, icon, color, sort_order, is_system)
SELECT id, 'Chambres', 'fa-bed', '#8B5CF6', 2, 1 FROM hotels
WHERE NOT EXISTS (SELECT 1 FROM chat_groups WHERE hotel_id = hotels.id AND name = 'Chambres');

-- Groupe 3 : Opérationnel
INSERT INTO chat_groups (hotel_id, name, icon, color, sort_order, is_system)
SELECT id, 'Opérationnel', 'fa-screwdriver-wrench', '#F59E0B', 3, 1 FROM hotels
WHERE NOT EXISTS (SELECT 1 FROM chat_groups WHERE hotel_id = hotels.id AND name = 'Opérationnel');

-- Salons par défaut — Espaces communs
INSERT INTO chat_channels (hotel_id, group_id, name, icon, sort_order)
SELECT g.hotel_id, g.id, 'réception', 'fa-bell-concierge', 1 FROM chat_groups g WHERE g.name = 'Espaces communs'
  AND NOT EXISTS (SELECT 1 FROM chat_channels WHERE group_id = g.id AND name = 'réception');
INSERT INTO chat_channels (hotel_id, group_id, name, icon, sort_order)
SELECT g.hotel_id, g.id, 'restaurant', 'fa-utensils', 2 FROM chat_groups g WHERE g.name = 'Espaces communs'
  AND NOT EXISTS (SELECT 1 FROM chat_channels WHERE group_id = g.id AND name = 'restaurant');
INSERT INTO chat_channels (hotel_id, group_id, name, icon, sort_order)
SELECT g.hotel_id, g.id, 'bar', 'fa-martini-glass', 3 FROM chat_groups g WHERE g.name = 'Espaces communs'
  AND NOT EXISTS (SELECT 1 FROM chat_channels WHERE group_id = g.id AND name = 'bar');
INSERT INTO chat_channels (hotel_id, group_id, name, icon, sort_order)
SELECT g.hotel_id, g.id, 'piscine', 'fa-water-ladder', 4 FROM chat_groups g WHERE g.name = 'Espaces communs'
  AND NOT EXISTS (SELECT 1 FROM chat_channels WHERE group_id = g.id AND name = 'piscine');
INSERT INTO chat_channels (hotel_id, group_id, name, icon, sort_order)
SELECT g.hotel_id, g.id, 'parking', 'fa-square-parking', 5 FROM chat_groups g WHERE g.name = 'Espaces communs'
  AND NOT EXISTS (SELECT 1 FROM chat_channels WHERE group_id = g.id AND name = 'parking');

-- Salons par défaut — Chambres (101 à 105, 201 à 205)
INSERT INTO chat_channels (hotel_id, group_id, name, icon, sort_order)
SELECT g.hotel_id, g.id, 'chambre-101', 'fa-bed', 1 FROM chat_groups g WHERE g.name = 'Chambres'
  AND NOT EXISTS (SELECT 1 FROM chat_channels WHERE group_id = g.id AND name = 'chambre-101');
INSERT INTO chat_channels (hotel_id, group_id, name, icon, sort_order)
SELECT g.hotel_id, g.id, 'chambre-102', 'fa-bed', 2 FROM chat_groups g WHERE g.name = 'Chambres'
  AND NOT EXISTS (SELECT 1 FROM chat_channels WHERE group_id = g.id AND name = 'chambre-102');
INSERT INTO chat_channels (hotel_id, group_id, name, icon, sort_order)
SELECT g.hotel_id, g.id, 'chambre-103', 'fa-bed', 3 FROM chat_groups g WHERE g.name = 'Chambres'
  AND NOT EXISTS (SELECT 1 FROM chat_channels WHERE group_id = g.id AND name = 'chambre-103');
INSERT INTO chat_channels (hotel_id, group_id, name, icon, sort_order)
SELECT g.hotel_id, g.id, 'chambre-104', 'fa-bed', 4 FROM chat_groups g WHERE g.name = 'Chambres'
  AND NOT EXISTS (SELECT 1 FROM chat_channels WHERE group_id = g.id AND name = 'chambre-104');
INSERT INTO chat_channels (hotel_id, group_id, name, icon, sort_order)
SELECT g.hotel_id, g.id, 'chambre-105', 'fa-bed', 5 FROM chat_groups g WHERE g.name = 'Chambres'
  AND NOT EXISTS (SELECT 1 FROM chat_channels WHERE group_id = g.id AND name = 'chambre-105');
INSERT INTO chat_channels (hotel_id, group_id, name, icon, sort_order)
SELECT g.hotel_id, g.id, 'chambre-201', 'fa-bed', 6 FROM chat_groups g WHERE g.name = 'Chambres'
  AND NOT EXISTS (SELECT 1 FROM chat_channels WHERE group_id = g.id AND name = 'chambre-201');
INSERT INTO chat_channels (hotel_id, group_id, name, icon, sort_order)
SELECT g.hotel_id, g.id, 'chambre-202', 'fa-bed', 7 FROM chat_groups g WHERE g.name = 'Chambres'
  AND NOT EXISTS (SELECT 1 FROM chat_channels WHERE group_id = g.id AND name = 'chambre-202');
INSERT INTO chat_channels (hotel_id, group_id, name, icon, sort_order)
SELECT g.hotel_id, g.id, 'chambre-203', 'fa-bed', 8 FROM chat_groups g WHERE g.name = 'Chambres'
  AND NOT EXISTS (SELECT 1 FROM chat_channels WHERE group_id = g.id AND name = 'chambre-203');
INSERT INTO chat_channels (hotel_id, group_id, name, icon, sort_order)
SELECT g.hotel_id, g.id, 'chambre-204', 'fa-bed', 9 FROM chat_groups g WHERE g.name = 'Chambres'
  AND NOT EXISTS (SELECT 1 FROM chat_channels WHERE group_id = g.id AND name = 'chambre-204');
INSERT INTO chat_channels (hotel_id, group_id, name, icon, sort_order)
SELECT g.hotel_id, g.id, 'chambre-205', 'fa-bed', 10 FROM chat_groups g WHERE g.name = 'Chambres'
  AND NOT EXISTS (SELECT 1 FROM chat_channels WHERE group_id = g.id AND name = 'chambre-205');

-- Salons par défaut — Opérationnel
INSERT INTO chat_channels (hotel_id, group_id, name, icon, sort_order)
SELECT g.hotel_id, g.id, 'ménage', 'fa-broom', 1 FROM chat_groups g WHERE g.name = 'Opérationnel'
  AND NOT EXISTS (SELECT 1 FROM chat_channels WHERE group_id = g.id AND name = 'ménage');
INSERT INTO chat_channels (hotel_id, group_id, name, icon, sort_order)
SELECT g.hotel_id, g.id, 'technique', 'fa-screwdriver-wrench', 2 FROM chat_groups g WHERE g.name = 'Opérationnel'
  AND NOT EXISTS (SELECT 1 FROM chat_channels WHERE group_id = g.id AND name = 'technique');
INSERT INTO chat_channels (hotel_id, group_id, name, icon, sort_order)
SELECT g.hotel_id, g.id, 'cuisine', 'fa-kitchen-set', 3 FROM chat_groups g WHERE g.name = 'Opérationnel'
  AND NOT EXISTS (SELECT 1 FROM chat_channels WHERE group_id = g.id AND name = 'cuisine');
INSERT INTO chat_channels (hotel_id, group_id, name, icon, sort_order)
SELECT g.hotel_id, g.id, 'urgence', 'fa-triangle-exclamation', 4 FROM chat_groups g WHERE g.name = 'Opérationnel'
  AND NOT EXISTS (SELECT 1 FROM chat_channels WHERE group_id = g.id AND name = 'urgence');
INSERT INTO chat_channels (hotel_id, group_id, name, icon, sort_order)
SELECT g.hotel_id, g.id, 'objets-trouvés', 'fa-magnifying-glass', 5 FROM chat_groups g WHERE g.name = 'Opérationnel'
  AND NOT EXISTS (SELECT 1 FROM chat_channels WHERE group_id = g.id AND name = 'objets-trouvés');
