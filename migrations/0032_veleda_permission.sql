-- ============================================
-- 0032 — Permission can_use_veleda
-- ============================================
-- Permission granulaire :
--   - users.can_use_veleda : peut creer / modifier / deplacer / redimensionner /
--     supprimer N'IMPORTE QUELLE note sur le tableau Veleda de son hotel.
-- (Voir le tableau Veleda en lecture = par defaut pour tous les staff, pas de permission requise)
--
-- Les admins recoivent automatiquement cette permission.
-- ============================================

ALTER TABLE users ADD COLUMN can_use_veleda INTEGER NOT NULL DEFAULT 0;

-- Tous les admins existants recoivent automatiquement cette permission
UPDATE users SET can_use_veleda = 1 WHERE role = 'admin';
