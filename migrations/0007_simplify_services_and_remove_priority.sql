-- ============================================
-- 0007 — Simplification de la sous-procédure "Présentation des services"
-- + Uniformisation des priorités (toutes 'normal' puisque le champ est retiré de l'UI)
-- + Correction des incohérences (recentrage check-in comme procédure principale)
-- ============================================

-- ============================================
-- 1) Uniformiser toutes les priorités à 'normal'
-- (le champ priority est retiré de l'UI, on neutralise sa valeur en DB)
-- ============================================
UPDATE procedures SET priority = 'normal';

-- ============================================
-- 2) Simplification de "Présentation du fonctionnement et des services"
-- → ne garder que petit-déj, restaurant, piscine, tennis, pétanque
-- ============================================

-- 2.A — Supprimer toutes les anciennes étapes de la sous-procédure services (id=4)
DELETE FROM steps WHERE procedure_id = (
  SELECT id FROM procedures WHERE hotel_id = 1 AND title = 'Présentation du fonctionnement et des services de l''hôtel'
);

-- 2.B — Mettre à jour les métadonnées (description simplifiée + trigger inchangé)
UPDATE procedures
SET description = 'Informations essentielles à donner au client lors du check-in : horaires des services et activités disponibles à l''hôtel.',
    trigger_event = 'Pendant le check-in, après les formalités administratives',
    updated_at = CURRENT_TIMESTAMP,
    version = version + 1
WHERE hotel_id = 1 AND title = 'Présentation du fonctionnement et des services de l''hôtel';

-- 2.C — Réinsérer 5 étapes simples : petit-déj, restaurant, piscine, tennis, pétanque
INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 1, 'Petit-déjeuner',
  '**Horaires :** 7h00 — 10h30' || char(10) ||
  '**Lieu :** Salle de restaurant au rez-de-chaussée',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Présentation du fonctionnement et des services de l''hôtel';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 2, 'Restaurant',
  '**Déjeuner :** 12h00 — 14h00' || char(10) ||
  '**Dîner :** 19h00 — 22h00' || char(10) ||
  '**Réservation conseillée**, surtout en saison.',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Présentation du fonctionnement et des services de l''hôtel';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 3, 'Piscine',
  '**Accès libre** pour tous les clients de l''hôtel.' || char(10) ||
  '**Horaires :** 8h00 — 20h00',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Présentation du fonctionnement et des services de l''hôtel';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 4, 'Tennis',
  '**Accès libre** pour tous les clients de l''hôtel.' || char(10) ||
  '**Horaires :** 8h00 — 20h00',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Présentation du fonctionnement et des services de l''hôtel';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 5, 'Pétanque',
  '**Accès libre** pour tous les clients de l''hôtel.' || char(10) ||
  '**Horaires :** 8h00 — 20h00',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Présentation du fonctionnement et des services de l''hôtel';

-- ============================================
-- 3) Changelog
-- ============================================
INSERT INTO changelog (hotel_id, procedure_id, user_id, action, summary, is_read_required)
SELECT 1, id, 1, 'updated', 'Sous-procédure "Présentation des services" simplifiée (petit-déj, restaurant, piscine, tennis, pétanque)', 0
FROM procedures WHERE hotel_id = 1 AND title = 'Présentation du fonctionnement et des services de l''hôtel';
