-- ============================================
-- 0006 — Restructuration Check-in Grand Hôtel des Lecques
-- avec sous-procédures détaillées et imbriquées
-- (version sans TEMP TABLE — compatible D1 remote)
-- ============================================
-- Hôtel = id 1 (Grand Hôtel des Lecques)
-- Catégorie Réception = id 1
-- Procédure principale check-in = id 1 (on la conserve, on la met à jour)

-- ============================================
-- 1) Nettoyage : suppression des anciennes étapes/conditions du check-in (id=1)
-- ============================================
DELETE FROM condition_steps WHERE condition_id IN (SELECT id FROM conditions WHERE procedure_id = 1);
DELETE FROM conditions WHERE procedure_id = 1;
DELETE FROM steps WHERE procedure_id = 1;

-- Suppression des anciennes sous-procédures (au cas où la migration aurait été partiellement exécutée)
DELETE FROM steps WHERE procedure_id IN (
  SELECT id FROM procedures WHERE hotel_id = 1 AND title IN (
    'Vérification d''identité du client',
    'Pré-autorisation bancaire',
    'Présentation du fonctionnement et des services de l''hôtel',
    'Remise de la carte de chambre + Wi-Fi',
    'Classement de la fiche d''arrivée'
  )
);
DELETE FROM procedures WHERE hotel_id = 1 AND title IN (
  'Vérification d''identité du client',
  'Pré-autorisation bancaire',
  'Présentation du fonctionnement et des services de l''hôtel',
  'Remise de la carte de chambre + Wi-Fi',
  'Classement de la fiche d''arrivée'
);

-- ============================================
-- 2.A — Sous-procédure : Vérification d'identité
-- ============================================
INSERT INTO procedures (hotel_id, category_id, title, description, trigger_event, priority, status, created_by)
VALUES (
  1, 1,
  'Vérification d''identité du client',
  'Procédure légale obligatoire à l''arrivée de chaque client (loi française : fiche individuelle de police pour les étrangers, vérification d''identité pour tous).',
  'Le client présente sa pièce d''identité au check-in',
  'high', 'active', 1
);

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 1, 'Demander la pièce d''identité',
  '**Demander poliment** une pièce d''identité officielle :' || char(10) ||
  '• Carte nationale d''identité (CNI) — clients UE' || char(10) ||
  '• Passeport — clients hors UE (obligatoire)' || char(10) ||
  '• Permis de conduire — accepté en dépannage uniquement' || char(10) || char(10) ||
  'Formulation type : « Pourriez-vous me présenter une pièce d''identité s''il vous plaît, c''est obligatoire pour finaliser votre arrivée. »',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Vérification d''identité du client';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 2, 'Vérifier la validité du document',
  'Contrôler :' || char(10) ||
  '• La **photo** correspond bien au client présent' || char(10) ||
  '• La **date d''expiration** n''est pas dépassée' || char(10) ||
  '• Le **nom et prénom** correspondent à ceux de la réservation' || char(10) || char(10) ||
  'En cas de doute → appeler le directeur ou le responsable d''astreinte.',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Vérification d''identité du client';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 3, 'Saisir les informations dans le PMS',
  'Dans le PMS, sur la fiche du client :' || char(10) ||
  '• Reporter le **numéro de pièce** d''identité' || char(10) ||
  '• Reporter le **type de document** (CNI / passeport)' || char(10) ||
  '• Reporter la **nationalité**' || char(10) ||
  '• Pour les **étrangers hors UE** : remplir obligatoirement la **fiche individuelle de police** (formulaire dédié dans le PMS).',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Vérification d''identité du client';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 4, 'Restituer la pièce d''identité',
  '**Toujours rendre** la pièce d''identité au client immédiatement après saisie.' || char(10) ||
  '⚠️ Ne **jamais conserver** une pièce d''identité, c''est interdit par la loi.',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Vérification d''identité du client';

-- ============================================
-- 2.B — Sous-procédure : Pré-autorisation bancaire
-- ============================================
INSERT INTO procedures (hotel_id, category_id, title, description, trigger_event, priority, status, created_by)
VALUES (
  1, 1,
  'Pré-autorisation bancaire',
  'Empreinte CB pour couvrir le séjour + extras éventuels (mini-bar, restaurant, dégradations). Indispensable pour sécuriser le règlement final.',
  'Après vérification d''identité, avant remise de la carte de chambre',
  'high', 'active', 1
);

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 1, 'Annoncer la pré-autorisation au client',
  'Phrase type : « Je vais procéder à une pré-autorisation sur votre carte bancaire pour le montant du séjour ainsi qu''une caution pour les éventuels extras. **Ce n''est pas un débit**, simplement une empreinte qui sera levée au check-out. »' || char(10) || char(10) ||
  'Toujours **expliquer avant** d''insérer la carte, jamais après.',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Pré-autorisation bancaire';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 2, 'Calculer le montant à pré-autoriser',
  '**Montant total = ** Prix du séjour + caution extras' || char(10) || char(10) ||
  '**Caution extras Grand Hôtel des Lecques :**' || char(10) ||
  '• Chambre standard : **80 €**' || char(10) ||
  '• Chambre supérieure / vue mer : **150 €**' || char(10) ||
  '• Suite : **250 €**' || char(10) || char(10) ||
  'Si réservation déjà prépayée (Booking.com prepaid, etc.) → ne pré-autoriser **que la caution extras**.',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Pré-autorisation bancaire';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 3, 'Insérer la carte dans le TPE',
  '• Demander au client d''**insérer ou présenter** sa carte sur le TPE' || char(10) ||
  '• Sélectionner « **Pré-autorisation** » (et non « Paiement »)' || char(10) ||
  '• Saisir le montant calculé' || char(10) ||
  '• Faire saisir le **code PIN** au client (ou validation sans contact si < 50 €)' || char(10) || char(10) ||
  '⚠️ Si le TPE refuse : essayer une 2ème carte du client. Si refus à nouveau → demander un règlement en espèces ou refuser le check-in après accord direction.',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Pré-autorisation bancaire';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 4, 'Conserver le ticket de pré-autorisation',
  '• Imprimer le **ticket TPE** confirmant la pré-autorisation' || char(10) ||
  '• L''**agrafer** à la fiche d''arrivée du client' || char(10) ||
  '• Reporter dans le PMS : montant pré-autorisé + 4 derniers chiffres de la carte + date.' || char(10) || char(10) ||
  '💡 Le ticket sera utile au check-out pour la levée de la pré-autorisation et pour traçabilité comptable.',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Pré-autorisation bancaire';

-- ============================================
-- 2.C — Sous-procédure : Présentation des services
-- ============================================
INSERT INTO procedures (hotel_id, category_id, title, description, trigger_event, priority, status, created_by)
VALUES (
  1, 1,
  'Présentation du fonctionnement et des services de l''hôtel',
  'Briefing complet à donner au client lors du check-in pour qu''il connaisse tous les services, horaires et accès. Étape clé de la qualité d''accueil et limite les appels à la réception ensuite.',
  'Le client est arrivé, identité vérifiée, pré-autorisation OK — avant remise de la carte',
  'normal', 'active', 1
);

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 1, 'Petit-déjeuner',
  '**Horaires :** 7h00 — 10h30 (du lundi au vendredi) / 7h30 — 11h00 (week-end et jours fériés)' || char(10) ||
  '**Lieu :** Salle de restaurant au rez-de-chaussée, à droite après la réception' || char(10) ||
  '**Formule :** Buffet continental complet (viennoiseries, charcuterie, fromages, fruits frais, jus, café, thé, chocolat chaud)' || char(10) || char(10) ||
  '**Tarif :**' || char(10) ||
  '• Inclus selon la réservation (vérifier dans le PMS)' || char(10) ||
  '• Sinon : **18 €/adulte**, **9 €/enfant** (moins de 12 ans), **gratuit** pour les moins de 4 ans' || char(10) || char(10) ||
  '💡 Préciser au client s''il a le petit-déjeuner inclus ou non — toujours vérifier sur sa fiche avant.',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Présentation du fonctionnement et des services de l''hôtel';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 2, 'Wi-Fi',
  '**Réseau :** `GrandHotelLecques-Guest`' || char(10) ||
  '**Mot de passe :** Indiqué sur la **pochette de la carte** remise au client' || char(10) || char(10) ||
  '**Couverture :** Toutes les chambres, hall, restaurant, terrasse, espace piscine.' || char(10) ||
  '**Qualité :** Fibre optique, débit suffisant pour streaming et visio.' || char(10) || char(10) ||
  '💡 En cas de problème de connexion → proposer de redémarrer le Wi-Fi du téléphone, sinon appeler la réception qui peut relancer la box.',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Présentation du fonctionnement et des services de l''hôtel';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 3, 'Parking',
  '**Parking privé fermé** de l''hôtel, accès par le portail latéral.' || char(10) || char(10) ||
  '**Tarif :** **15 €/nuit** (à régler au check-out, ajouté à la note)' || char(10) ||
  '**Code portail :** `5482`' || char(10) ||
  '**Capacité :** 22 places, fonctionne en premier arrivé / premier servi.' || char(10) || char(10) ||
  '⚠️ Si parking complet → orienter vers le parking municipal Place de la Liberté (300 m, payant en saison, gratuit hors saison).' || char(10) || char(10) ||
  '💡 Précisez bien : « Le code est à composer à l''aller comme au retour, le portail se referme automatiquement après 30 secondes. »',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Présentation du fonctionnement et des services de l''hôtel';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 4, 'Restaurant et bar de l''hôtel',
  '**Restaurant « La Table des Lecques »** :' || char(10) ||
  '• Déjeuner : 12h00 — 14h00 (sauf dimanche soir et lundi)' || char(10) ||
  '• Dîner : 19h00 — 22h00' || char(10) ||
  '• Cuisine méditerranéenne, produits frais et locaux' || char(10) ||
  '• **Réservation conseillée**, surtout en saison — proposer de réserver directement à l''accueil' || char(10) || char(10) ||
  '**Bar** :' || char(10) ||
  '• Ouvert de 17h00 à 23h00' || char(10) ||
  '• Carte de cocktails, vins de Provence, planches apéritives' || char(10) ||
  '• Service en terrasse l''été',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Présentation du fonctionnement et des services de l''hôtel';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 5, 'Piscine, jacuzzi et espace bien-être',
  '**Piscine extérieure chauffée** :' || char(10) ||
  '• Ouverte de 8h00 à 20h00 (mai → septembre)' || char(10) ||
  '• Accès libre pour tous les clients' || char(10) ||
  '• **Serviettes piscine** disponibles à la réception (à demander)' || char(10) || char(10) ||
  '**Jacuzzi extérieur** :' || char(10) ||
  '• 8h00 — 22h00 toute l''année' || char(10) ||
  '• Capacité : 6 personnes maximum' || char(10) || char(10) ||
  '⚠️ **Règles :**' || char(10) ||
  '• Douche obligatoire avant baignade' || char(10) ||
  '• Enfants de moins de 12 ans accompagnés d''un adulte uniquement' || char(10) ||
  '• Pas de verre en bord de piscine' || char(10) ||
  '• Pas de musique sans écouteurs',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Présentation du fonctionnement et des services de l''hôtel';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 6, 'Accès chambre et étages',
  '**Ascenseur :** au fond du hall, à gauche après la réception' || char(10) ||
  '**Étages :** RDC à 4ème étage' || char(10) ||
  '**Accès :** carte magnétique requise pour activer l''ascenseur après 22h00 (sécurité de nuit)' || char(10) || char(10) ||
  '💡 Indiquer au client le **numéro et l''étage** de sa chambre clairement, et lui montrer la direction de l''ascenseur.',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Présentation du fonctionnement et des services de l''hôtel';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 7, 'Ménage, linge et room service',
  '**Ménage quotidien :** entre 9h00 et 14h00' || char(10) ||
  '• Si le client ne veut pas être dérangé → accrocher le panneau « Ne pas déranger » à la poignée' || char(10) ||
  '• Si besoin de serviettes/produits supplémentaires → appeler la réception (poste 9)' || char(10) || char(10) ||
  '**Changement de draps :** tous les 3 jours (sauf demande)' || char(10) ||
  '**Room service :** 18h00 — 22h00, carte légère disponible dans la chambre.' || char(10) || char(10) ||
  '💡 Mentionner au client qu''il peut demander un **oreiller supplémentaire**, une **couverture**, ou des **produits de toilette** sans frais à tout moment.',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Présentation du fonctionnement et des services de l''hôtel';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 8, 'Numéros utiles depuis la chambre',
  'Sur le téléphone de chambre :' || char(10) ||
  '• **9** → Réception (24h/24)' || char(10) ||
  '• **6** → Restaurant (pendant les services)' || char(10) ||
  '• **7** → Bar (17h-23h)' || char(10) ||
  '• **0** → Sortie ligne extérieure' || char(10) || char(10) ||
  '**En cas d''urgence :** composer le **15** (SAMU) ou le **18** (pompiers) — la ligne sort automatiquement.',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Présentation du fonctionnement et des services de l''hôtel';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 9, 'Check-out et late check-out',
  '**Check-out standard :** avant **11h00** le jour du départ' || char(10) ||
  '**Late check-out (départ tardif) :**' || char(10) ||
  '• Jusqu''à **13h00** : gratuit selon disponibilité' || char(10) ||
  '• Jusqu''à **15h00** : **30 €** supplémentaires' || char(10) ||
  '• Au-delà : facturation d''une nuit supplémentaire' || char(10) || char(10) ||
  '💡 Mentionner que le client peut **laisser ses bagages à la réception** après le check-out, gratuitement, pour profiter de sa journée avant de partir.',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Présentation du fonctionnement et des services de l''hôtel';

-- ============================================
-- 2.D — Sous-procédure : Remise carte + Wi-Fi
-- ============================================
INSERT INTO procedures (hotel_id, category_id, title, description, trigger_event, priority, status, created_by)
VALUES (
  1, 1,
  'Remise de la carte de chambre + Wi-Fi',
  'Procédure de remise au client de sa carte magnétique préalablement préparée et de son code Wi-Fi. La carte a été programmée et placée dans une pochette nominative en amont (voir procédure « Préparation des cartes de chambre »).',
  'Tous les contrôles sont OK, le client peut accéder à sa chambre',
  'normal', 'active', 1
);

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 1, 'Récupérer la pochette préparée dans le rack',
  'Le rack des arrivées du jour se trouve **derrière le comptoir, classé par numéro de chambre croissant**.' || char(10) || char(10) ||
  '• Repérer la pochette correspondant au **numéro de chambre attribué** au client' || char(10) ||
  '• La sortir du rack' || char(10) || char(10) ||
  '⚠️ Si **pas de pochette préparée** dans le rack → vérifier dans la « zone des préparations en cours » (tiroir du bas). Si absente partout → préparer une carte en urgence (voir procédure « Préparation d''une carte en urgence »).',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Remise de la carte de chambre + Wi-Fi';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 2, 'Vérifier la concordance carte / client',
  'Avant de remettre la pochette, **vérifier impérativement** :' || char(10) ||
  '• Le **nom inscrit sur la pochette** correspond bien au client présent' || char(10) ||
  '• Le **numéro de chambre** correspond à celui du PMS' || char(10) ||
  '• La pochette contient bien **2 cartes** (1 principale + 1 de secours)' || char(10) || char(10) ||
  '⚠️ En cas d''incohérence → **ne pas remettre la pochette**. Reprogrammer la carte avec le bon nom/numéro avant de continuer.',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Remise de la carte de chambre + Wi-Fi';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 3, 'Présenter la pochette au client',
  '**Tendre la pochette** au client en posant les deux mains dessus (geste d''accueil), et annoncer :' || char(10) || char(10) ||
  '« Voici votre carte pour la chambre **[numéro]**, située au **[étage]**. Vous trouverez **2 cartes** dans la pochette ainsi que le **code Wi-Fi** au dos. »',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Remise de la carte de chambre + Wi-Fi';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 4, 'Expliquer l''usage de la carte',
  'La **carte magnétique** sert à plusieurs choses :' || char(10) ||
  '• **Ouvrir la porte** de la chambre (passer la carte devant le lecteur jusqu''au signal vert)' || char(10) ||
  '• **Activer l''électricité** dans la chambre (insérer la carte dans le boîtier près de la porte en entrant)' || char(10) ||
  '• **Activer l''ascenseur** la nuit (après 22h00, passer la carte sur le lecteur ascenseur)' || char(10) ||
  '• **Accéder à la piscine** et au jacuzzi (carte requise sur le portillon)' || char(10) || char(10) ||
  '💡 Précisez : « Si vous sortez la carte du boîtier électrique, l''électricité de la chambre se coupe automatiquement après 30 secondes — c''est une économie d''énergie. »',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Remise de la carte de chambre + Wi-Fi';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 5, 'Donner le code Wi-Fi',
  'Le code Wi-Fi est **imprimé au dos de la pochette** (étiquette autocollante).' || char(10) || char(10) ||
  '**Le réciter à voix haute** au client en pointant l''étiquette :' || char(10) ||
  '• « Le réseau s''appelle **GrandHotelLecques-Guest** »' || char(10) ||
  '• « Le mot de passe est inscrit ici, juste sous le numéro de chambre »' || char(10) || char(10) ||
  '💡 Pour les clients âgés ou peu à l''aise avec la tech, **proposer spontanément** de les aider à se connecter depuis leur téléphone à la chambre (en leur indiquant qu''il leur suffit d''appeler la réception, poste 9).',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Remise de la carte de chambre + Wi-Fi';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 6, 'Indiquer comment se connecter au Wi-Fi',
  'Méthode standard pour se connecter (à expliquer si le client semble incertain) :' || char(10) || char(10) ||
  '1. Aller dans **Réglages > Wi-Fi** sur smartphone / ordinateur' || char(10) ||
  '2. Sélectionner le réseau **`GrandHotelLecques-Guest`**' || char(10) ||
  '3. Saisir le **mot de passe** (sensible aux majuscules/minuscules)' || char(10) ||
  '4. Une fois connecté, **accepter les conditions** sur la page d''accueil qui s''ouvre automatiquement' || char(10) || char(10) ||
  '💡 Le Wi-Fi est valable pour **tous les appareils du client** durant son séjour, pas besoin de se reconnecter chaque jour.',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Remise de la carte de chambre + Wi-Fi';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 7, 'Que faire si la carte est démagnétisée',
  '**Symptômes** : la carte ne déclenche pas le voyant vert sur la porte, ou le voyant clignote rouge.' || char(10) || char(10) ||
  '**Causes fréquentes :**' || char(10) ||
  '• Carte mise au contact d''un téléphone, d''un sac avec aimant, ou d''autres cartes magnétiques' || char(10) ||
  '• Démagnétisation naturelle après plusieurs jours' || char(10) || char(10) ||
  '**Solution :**' || char(10) ||
  '1. Inviter le client à revenir à la réception avec la carte' || char(10) ||
  '2. **Re-encoder la carte** sur l''encodeur (3 secondes) avec le numéro de chambre dans le PMS' || char(10) ||
  '3. Tester la nouvelle carte sur le lecteur de la réception avant de la remettre' || char(10) || char(10) ||
  '💡 Donner systématiquement la **2ème carte de secours** au client en attendant si la 1ère échoue, pour ne pas le bloquer dans le couloir.',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Remise de la carte de chambre + Wi-Fi';

-- ============================================
-- 2.E — Sous-procédure : Classement fiche d'arrivée
-- ============================================
INSERT INTO procedures (hotel_id, category_id, title, description, trigger_event, priority, status, created_by)
VALUES (
  1, 1,
  'Classement de la fiche d''arrivée',
  'Une fois le client en chambre, finalisation administrative : saisie complète dans le PMS et classement physique de la fiche d''arrivée pour traçabilité.',
  'Le client est parti vers sa chambre après le check-in',
  'low', 'active', 1
);

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 1, 'Finaliser la saisie dans le PMS',
  'Sur la fiche client du PMS, vérifier que les éléments suivants sont bien renseignés :' || char(10) ||
  '• Statut **« Arrivé »** (et non plus « Attendu »)' || char(10) ||
  '• Heure d''arrivée réelle' || char(10) ||
  '• Numéro de chambre attribué' || char(10) ||
  '• Pré-autorisation enregistrée (montant + 4 derniers chiffres CB)' || char(10) ||
  '• Pièce d''identité saisie' || char(10) ||
  '• Demandes spéciales du client (allergies, lit bébé, vue, etc.)' || char(10) || char(10) ||
  '💡 Une fiche bien renseignée = un check-out fluide.',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Classement de la fiche d''arrivée';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 2, 'Agrafer les justificatifs',
  'Sur la **fiche d''arrivée papier**, agrafer dans cet ordre :' || char(10) ||
  '1. **Ticket de pré-autorisation** TPE' || char(10) ||
  '2. **Copie de la fiche de police** (clients étrangers hors UE uniquement)' || char(10) ||
  '3. Éventuels bons d''agence ou documents Booking.com' || char(10) || char(10) ||
  '⚠️ Ne **jamais agrafer** la photocopie d''une pièce d''identité (interdit par la loi RGPD).',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Classement de la fiche d''arrivée';

INSERT INTO steps (procedure_id, step_number, title, content, step_type)
SELECT id, 3, 'Classer dans le classeur des arrivées du jour',
  'Le **classeur « Arrivées du jour »** se trouve dans le tiroir gauche de la réception.' || char(10) || char(10) ||
  '• Classer la fiche **par numéro de chambre croissant**' || char(10) ||
  '• Vérifier qu''il n''y a pas déjà une fiche pour la même chambre (sinon → conflit à signaler immédiatement)' || char(10) || char(10) ||
  '💡 Le classeur est archivé chaque soir par le réceptionniste de nuit dans le classeur mensuel.',
  'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Classement de la fiche d''arrivée';

-- ============================================
-- 3) Reconstruction de la procédure principale (id=1)
-- ============================================
UPDATE procedures
SET title = 'Check-in d''un client à la réception',
    description = 'Procédure complète d''accueil et d''enregistrement d''un client à son arrivée à la réception du Grand Hôtel des Lecques. Combine étapes simples (accueil, vérification réservation, accompagnement) et sous-procédures détaillées pour les opérations techniques (identité, pré-autorisation, présentation services, remise carte, classement).',
    trigger_event = 'Un client arrive à la réception pour s''enregistrer',
    category_id = 1,
    priority = 'high',
    status = 'active',
    updated_at = CURRENT_TIMESTAMP,
    version = version + 1
WHERE id = 1;

-- Étape 1 : Accueil (simple)
INSERT INTO steps (procedure_id, step_number, title, content, linked_procedure_id, step_type)
VALUES (1, 1, 'Accueillir le client',
  'Dès que le client entre dans le hall :' || char(10) ||
  '• **Lever la tête, sourire**, établir un contact visuel' || char(10) ||
  '• Se lever si on est assis' || char(10) ||
  '• Saluer chaleureusement : « Bonjour Monsieur / Madame, bienvenue au Grand Hôtel des Lecques »' || char(10) ||
  '• Si plusieurs clients en attente → **les saluer tous** d''un signe de tête en arrivant' || char(10) || char(10) ||
  '💡 Les **20 premières secondes** déterminent la perception qu''aura le client de tout son séjour. Ne jamais bâcler l''accueil, même en pleine rush.',
  NULL, 'action');

-- Étape 2 : Vérifier réservation (simple)
INSERT INTO steps (procedure_id, step_number, title, content, linked_procedure_id, step_type)
VALUES (1, 2, 'Vérifier la réservation',
  'Demander le **nom du client** (jamais « avez-vous une réservation ? » qui sonne suspicieux) :' || char(10) ||
  '« Pour quel nom est la réservation s''il vous plaît ? »' || char(10) || char(10) ||
  'Dans le PMS :' || char(10) ||
  '• Rechercher la réservation par nom' || char(10) ||
  '• Vérifier les **dates** (arrivée + départ)' || char(10) ||
  '• Vérifier le **type de chambre** réservée' || char(10) ||
  '• Vérifier les **conditions** (petit-déj inclus ou non, prépayé ou non, demandes spéciales)' || char(10) || char(10) ||
  '⚠️ Si la réservation est introuvable → demander la confirmation du client (mail, capture, n° de réservation Booking) avant de conclure à un problème. Si vraiment absente → escalader au responsable.',
  NULL, 'action');

-- Étape 3 : Vérifier identité (sous-procédure)
INSERT INTO steps (procedure_id, step_number, title, content, linked_procedure_id, step_type)
SELECT 1, 3, 'Vérifier l''identité du client',
  'Étape légale obligatoire — voir sous-procédure dédiée pour le détail.',
  id, 'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Vérification d''identité du client';

-- Étape 4 : Pré-autorisation (sous-procédure)
INSERT INTO steps (procedure_id, step_number, title, content, linked_procedure_id, step_type)
SELECT 1, 4, 'Effectuer la pré-autorisation bancaire',
  'Empreinte CB pour le séjour + caution extras — voir sous-procédure dédiée pour le détail.',
  id, 'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Pré-autorisation bancaire';

-- Étape 5 : Présentation services (sous-procédure) ⭐
INSERT INTO steps (procedure_id, step_number, title, content, linked_procedure_id, step_type)
SELECT 1, 5, 'Présenter le fonctionnement et les services de l''hôtel',
  'Briefing complet : petit-déjeuner, Wi-Fi, parking, restaurant, piscine, ménage, numéros utiles, check-out — voir sous-procédure dédiée pour le détail.',
  id, 'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Présentation du fonctionnement et des services de l''hôtel';

-- Étape 6 : Remise carte + Wi-Fi (sous-procédure) ⭐
INSERT INTO steps (procedure_id, step_number, title, content, linked_procedure_id, step_type)
SELECT 1, 6, 'Remettre la carte de chambre et indiquer le code Wi-Fi',
  'Récupération de la pochette préparée en amont, vérification, remise et explication d''usage — voir sous-procédure dédiée pour le détail.',
  id, 'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Remise de la carte de chambre + Wi-Fi';

-- Étape 7 : Accompagnement (simple)
INSERT INTO steps (procedure_id, step_number, title, content, linked_procedure_id, step_type)
VALUES (1, 7, 'Proposer un accompagnement à la chambre',
  'Demander au client s''il souhaite être accompagné jusqu''à sa chambre :' || char(10) || char(10) ||
  '« Souhaitez-vous que je vous accompagne jusqu''à votre chambre ? »' || char(10) || char(10) ||
  '**Cas où l''accompagnement est fortement recommandé :**' || char(10) ||
  '• Client âgé ou à mobilité réduite' || char(10) ||
  '• Client avec **bagages volumineux** → proposer aussi le **chariot à bagages** (à côté de l''ascenseur)' || char(10) ||
  '• Client **VIP** ou réservation spéciale (anniversaire, lune de miel)' || char(10) ||
  '• **Première arrivée** en clientèle régulière' || char(10) || char(10) ||
  '💡 Si pas possible de quitter la réception (rush, pas de collègue dispo) → s''excuser, indiquer le chemin précisément, et proposer d''appeler en cas de besoin.',
  NULL, 'action');

-- Étape 8 : Bon séjour (simple)
INSERT INTO steps (procedure_id, step_number, title, content, linked_procedure_id, step_type)
VALUES (1, 8, 'Souhaiter un bon séjour',
  'Avant que le client ne parte vers sa chambre :' || char(10) || char(10) ||
  '« Je vous souhaite un excellent séjour au Grand Hôtel des Lecques. **N''hésitez pas** à nous appeler au poste 9 si vous avez besoin de quoi que ce soit. »' || char(10) || char(10) ||
  '💡 Toujours **personnaliser** avec le nom du client (« Monsieur Dupont, je vous souhaite... ») et un sourire sincère.',
  NULL, 'action');

-- Étape 9 : Classement fiche (sous-procédure)
INSERT INTO steps (procedure_id, step_number, title, content, linked_procedure_id, step_type)
SELECT 1, 9, 'Classer la fiche d''arrivée',
  'Une fois le client parti, finaliser le PMS et classer la fiche papier — voir sous-procédure dédiée pour le détail.',
  id, 'action'
FROM procedures WHERE hotel_id = 1 AND title = 'Classement de la fiche d''arrivée';

-- ============================================
-- Changelog
-- ============================================
INSERT INTO changelog (hotel_id, procedure_id, user_id, action, summary, is_read_required)
VALUES (1, 1, 1, 'updated', 'Procédure check-in restructurée avec sous-procédures détaillées (identité, pré-autorisation, services hôtel, carte de chambre, classement)', 1);
