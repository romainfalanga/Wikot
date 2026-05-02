-- ============================================
-- WIKOT - Hotel Procedure Management System
-- Initial Database Schema
-- ============================================

-- Hotels table
CREATE TABLE IF NOT EXISTS hotels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  address TEXT,
  logo_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Users table (super_admin, admin, employee)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('super_admin', 'admin', 'employee')),
  avatar_url TEXT,
  is_active INTEGER DEFAULT 1,
  last_login DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id)
);

-- Categories for organizing procedures
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  icon TEXT DEFAULT 'fa-folder',
  color TEXT DEFAULT '#3B82F6',
  parent_id INTEGER,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id),
  FOREIGN KEY (parent_id) REFERENCES categories(id)
);

-- Procedures (the main container: a trigger + its steps)
CREATE TABLE IF NOT EXISTS procedures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  category_id INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  trigger_event TEXT NOT NULL,
  trigger_icon TEXT DEFAULT 'fa-bolt',
  trigger_conditions TEXT,
  priority TEXT DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high', 'critical')),
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'archived')),
  is_template INTEGER DEFAULT 0,
  version INTEGER DEFAULT 1,
  created_by INTEGER,
  approved_by INTEGER,
  approved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id),
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

-- Steps of a procedure (what to do when the trigger fires)
CREATE TABLE IF NOT EXISTS steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  procedure_id INTEGER NOT NULL,
  step_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  step_type TEXT DEFAULT 'action' CHECK(step_type IN ('action', 'decision', 'notification', 'escalation', 'check')),
  details TEXT,
  warning TEXT,
  tip TEXT,
  duration_minutes INTEGER,
  is_optional INTEGER DEFAULT 0,
  condition_text TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (procedure_id) REFERENCES procedures(id) ON DELETE CASCADE
);

-- Sub-conditions / branches (when trigger has specific sub-cases)
CREATE TABLE IF NOT EXISTS conditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  procedure_id INTEGER NOT NULL,
  parent_condition_id INTEGER,
  condition_text TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (procedure_id) REFERENCES procedures(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_condition_id) REFERENCES conditions(id)
);

-- Steps specific to a condition branch
CREATE TABLE IF NOT EXISTS condition_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  condition_id INTEGER NOT NULL,
  step_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  step_type TEXT DEFAULT 'action' CHECK(step_type IN ('action', 'decision', 'notification', 'escalation', 'check')),
  details TEXT,
  warning TEXT,
  tip TEXT,
  duration_minutes INTEGER,
  is_optional INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (condition_id) REFERENCES conditions(id) ON DELETE CASCADE
);

-- Suggestions from employees
CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  procedure_id INTEGER,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('new_procedure', 'improvement', 'issue')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'reviewed', 'approved', 'rejected', 'implemented')),
  admin_response TEXT,
  reviewed_by INTEGER,
  reviewed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id),
  FOREIGN KEY (procedure_id) REFERENCES procedures(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

-- Changelog for procedure changes
CREATE TABLE IF NOT EXISTS changelog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  procedure_id INTEGER,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('created', 'updated', 'activated', 'archived', 'approved', 'rejected')),
  summary TEXT NOT NULL,
  details TEXT,
  is_read_required INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id),
  FOREIGN KEY (procedure_id) REFERENCES procedures(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Track who has acknowledged reading changelog entries
CREATE TABLE IF NOT EXISTS changelog_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  changelog_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (changelog_id) REFERENCES changelog(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(changelog_id, user_id)
);

-- Templates (super_admin creates templates hotels can import)
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  category_name TEXT,
  trigger_event TEXT NOT NULL,
  trigger_conditions TEXT,
  steps_json TEXT NOT NULL,
  conditions_json TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_hotel ON users(hotel_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_procedures_hotel ON procedures(hotel_id);
CREATE INDEX IF NOT EXISTS idx_procedures_category ON procedures(category_id);
CREATE INDEX IF NOT EXISTS idx_procedures_status ON procedures(status);
CREATE INDEX IF NOT EXISTS idx_steps_procedure ON steps(procedure_id);
CREATE INDEX IF NOT EXISTS idx_conditions_procedure ON conditions(procedure_id);
CREATE INDEX IF NOT EXISTS idx_condition_steps_condition ON condition_steps(condition_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_hotel ON suggestions(hotel_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(status);
CREATE INDEX IF NOT EXISTS idx_changelog_hotel ON changelog(hotel_id);
CREATE INDEX IF NOT EXISTS idx_changelog_reads_user ON changelog_reads(user_id);
