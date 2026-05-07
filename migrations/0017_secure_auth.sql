-- ============================================
-- Migration 0017 — Sécurité auth
-- ============================================
-- 1. Ajout colonnes pour PBKDF2 (hash + salt)
-- 2. Table user_sessions pour tokens random non-prédictibles
-- 3. Lazy migration : password_hash actuel reste en place,
--    re-hashé automatiquement au prochain login réussi
-- ============================================

-- 1. Colonnes PBKDF2 (NULL = pas encore migré, lazy upgrade au login)
ALTER TABLE users ADD COLUMN password_hash_v2 TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN password_algo TEXT; -- 'pbkdf2-sha256-100k'

-- 2. Table user_sessions (tokens random, expirables, révocables)
CREATE TABLE IF NOT EXISTS user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  user_agent TEXT,
  ip_address TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
