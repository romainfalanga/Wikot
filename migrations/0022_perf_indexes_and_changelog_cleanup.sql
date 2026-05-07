-- Migration 0022 : index suggestions + cleanup changelog
-- ======================================================
-- Objectifs :
-- 1) Index sur suggestions(hotel_id, status, created_at DESC)
--    → la liste /api/suggestions filtrée par status devient instantanée
--      même avec des milliers de suggestions par hôtel.
-- 2) Index sur suggestions(hotel_id, user_id, created_at DESC)
--    → liste employee (filtrage par user_id) optimisée.
-- 3) Cleanup changelog : on purge les entrées > 90 jours
--    (la page "Historique" a été supprimée de l'UI, le changelog ne sert
--    plus que d'audit interne, pas la peine de le garder éternellement).
-- 4) Index changelog(hotel_id, created_at DESC) pour purges efficaces.
-- 5) ANALYZE final pour rafraîchir le query planner.

-- 1) Index suggestions filtrage status
CREATE INDEX IF NOT EXISTS idx_suggestions_hotel_status_created
  ON suggestions(hotel_id, status, created_at DESC);

-- 2) Index suggestions filtrage employee
CREATE INDEX IF NOT EXISTS idx_suggestions_hotel_user_created
  ON suggestions(hotel_id, user_id, created_at DESC);

-- 3) Purge changelog > 90 jours (one-shot)
DELETE FROM changelog WHERE created_at < datetime('now', '-90 days');

-- 4) Index changelog pour purges futures (le cron R2 pourra réutiliser ce pattern)
CREATE INDEX IF NOT EXISTS idx_changelog_hotel_created
  ON changelog(hotel_id, created_at DESC);

-- 5) Refresh query planner stats
ANALYZE;
