-- 0024 — Normalisation email + rôle métier
-- ============================================
-- 1) Bug fix login : la création faisait toLowerCase() mais le login matchait
--    en case-sensitive. On normalise tous les emails et on impose une unicité
--    case-insensitive via un index unique sur LOWER(email).
-- 2) Ajout du rôle métier (job_role) pour distinguer réception/serveur/etc.
--    (différent du rôle système employee/admin/super_admin).

-- Normalisation des emails existants
UPDATE users SET email = LOWER(TRIM(email)) WHERE email != LOWER(TRIM(email));

-- Index unique case-insensitive (anti-doublon Stephanie@... vs stephanie@...)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));

-- Rôle métier : réception, serveur, cuisinier, housekeeping, maintenance, manager, autre
-- NULL = non défini (cas par défaut pour les comptes existants)
ALTER TABLE users ADD COLUMN job_role TEXT DEFAULT NULL;
