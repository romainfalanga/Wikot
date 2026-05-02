-- ============================================
-- WIKOT - Seed Data for Development
-- ============================================

-- Hotel
INSERT OR IGNORE INTO hotels (id, name, slug, address) VALUES
  (1, 'Hôtel Le Grand Paris', 'grand-paris', '15 Rue de Rivoli, 75001 Paris'),
  (2, 'Hôtel Côte d''Azur', 'cote-azur', '22 Promenade des Anglais, 06000 Nice');

-- Users (password: "demo123" - hashed with simple hash for demo)
INSERT OR IGNORE INTO users (id, hotel_id, email, password_hash, name, role) VALUES
  (1, NULL, 'romain@wikot.app', 'demo123', 'Romain', 'super_admin'),
  (2, 1, 'marie@grandparis.com', 'demo123', 'Marie Dupont', 'admin'),
  (3, 1, 'jean@grandparis.com', 'demo123', 'Jean Martin', 'employee'),
  (4, 1, 'sophie@grandparis.com', 'demo123', 'Sophie Leroux', 'employee'),
  (5, 2, 'luc@coteazur.com', 'demo123', 'Luc Bernard', 'admin'),
  (6, 2, 'emma@coteazur.com', 'demo123', 'Emma Petit', 'employee');

-- Categories for Hotel 1
INSERT OR IGNORE INTO categories (id, hotel_id, name, icon, color, sort_order) VALUES
  (1, 1, 'Réception / Front Office', 'fa-concierge-bell', '#3B82F6', 1),
  (2, 1, 'Housekeeping', 'fa-broom', '#10B981', 2),
  (3, 1, 'Restauration', 'fa-utensils', '#F59E0B', 3),
  (4, 1, 'Maintenance', 'fa-wrench', '#EF4444', 4),
  (5, 1, 'Sécurité & Urgences', 'fa-shield-halved', '#DC2626', 5),
  (6, 1, 'Relations Clients', 'fa-heart', '#EC4899', 6);

-- Categories for Hotel 2
INSERT OR IGNORE INTO categories (id, hotel_id, name, icon, color, sort_order) VALUES
  (7, 2, 'Réception', 'fa-concierge-bell', '#3B82F6', 1),
  (8, 2, 'Étages', 'fa-broom', '#10B981', 2),
  (9, 2, 'Restaurant & Bar', 'fa-utensils', '#F59E0B', 3);

-- ============================================
-- PROCEDURES for Hotel 1 - Le Grand Paris
-- ============================================

-- Procedure 1: Check-in client
INSERT OR IGNORE INTO procedures (id, hotel_id, category_id, title, description, trigger_event, trigger_icon, priority, status, version, created_by, approved_by) VALUES
  (1, 1, 1, 'Check-in d''un client', 'Procédure complète pour l''enregistrement d''un client à son arrivée', 'Un client arrive à la réception pour s''enregistrer', 'fa-door-open', 'normal', 'active', 1, 2, 2);

INSERT OR IGNORE INTO steps (id, procedure_id, step_number, title, description, step_type, details, tip) VALUES
  (1, 1, 1, 'Accueillir le client', 'Saluer le client avec le sourire et lui souhaiter la bienvenue', 'action', 'Formule : "Bonjour et bienvenue à l''Hôtel Le Grand Paris ! Je suis [prénom], comment puis-je vous aider ?"', 'Si le client semble fatigué après un long voyage, proposez-lui immédiatement un verre d''eau ou un café.'),
  (2, 1, 2, 'Demander le nom ou la référence de réservation', 'Rechercher la réservation dans le PMS', 'action', 'Ouvrir le logiciel PMS > Onglet "Arrivées du jour" > Rechercher par nom ou numéro de réservation', NULL),
  (3, 1, 3, 'Vérifier l''identité', 'Demander une pièce d''identité et vérifier la correspondance', 'check', 'Scanner ou photocopier la pièce d''identité. Vérifier : nom, photo, date de validité.', 'Pour les clients étrangers, vérifier aussi le visa si nécessaire.'),
  (4, 1, 4, 'Confirmer les détails du séjour', 'Récapituler dates, type de chambre, nombre de personnes, prestations incluses', 'action', 'Vérifier : dates d''arrivée/départ, type de chambre, petit-déjeuner inclus, demandes spéciales', NULL),
  (5, 1, 5, 'Procéder au pré-paiement', 'Prendre l''empreinte bancaire ou le paiement', 'action', 'Utiliser le TPE pour prendre une empreinte CB. Montant = total séjour + caution. Si paiement par virement/agence, vérifier la confirmation.', 'Ne jamais mentionner le prix à voix haute si d''autres clients sont à proximité.'),
  (6, 1, 6, 'Remettre la clé et expliquer les services', 'Programmer la clé, expliquer WiFi, petit-déjeuner, services', 'action', 'Programmer la clé magnétique. Remettre le livret d''accueil. Expliquer : horaires petit-déjeuner, code WiFi, numéro de la réception.', NULL),
  (7, 1, 7, 'Proposer l''accompagnement en chambre', 'Pour les clients premium ou si bagages lourds', 'action', 'Appeler le bagagiste si disponible, sinon proposer de montrer le chemin.', NULL);

-- Conditions for Check-in
INSERT OR IGNORE INTO conditions (id, procedure_id, condition_text, description, sort_order) VALUES
  (1, 1, 'Le client n''a pas de réservation (walk-in)', 'Un client se présente sans réservation préalable', 1),
  (2, 1, 'Le client a une réclamation sur la chambre attribuée', 'Le client n''est pas satisfait de la chambre proposée', 2),
  (3, 1, 'Le client est un VIP ou membre fidélité', 'Client identifié comme VIP dans le PMS', 3);

INSERT OR IGNORE INTO condition_steps (id, condition_id, step_number, title, description, step_type, details, warning) VALUES
  (1, 1, 1, 'Vérifier la disponibilité', 'Consulter les chambres disponibles dans le PMS', 'action', 'PMS > Disponibilités > Date du jour. Vérifier les chambres propres et inspectées.', NULL),
  (2, 1, 2, 'Proposer les tarifs', 'Présenter les options et tarifs rack', 'action', 'Afficher le tarif rack. Si le client hésite, proposer un upgrade ou un tarif préférentiel (si autorisé par le manager).', 'Ne jamais proposer de réduction sans accord du responsable.'),
  (3, 1, 3, 'Créer la réservation', 'Saisir tous les détails dans le PMS', 'action', 'PMS > Nouvelle réservation > Saisir nom, dates, chambre, tarif, mode de paiement.', NULL),
  (4, 2, 1, 'Écouter la réclamation', 'Laisser le client s''exprimer sans l''interrompre', 'action', 'Montrer de l''empathie. Prendre note de la réclamation.', NULL),
  (5, 2, 2, 'Proposer une alternative', 'Chercher une chambre similaire ou supérieure disponible', 'action', 'Vérifier les disponibilités. Proposer un changement de chambre gratuit si possible.', 'Si aucune chambre disponible, contacter le responsable immédiatement.'),
  (6, 3, 1, 'Accueil personnalisé VIP', 'Utiliser le nom du client, mentionner son statut', 'action', '"Bienvenue M./Mme [nom], nous sommes ravis de vous revoir. Votre suite est prête."', NULL),
  (7, 3, 2, 'Offrir les attentions VIP', 'Vérifier que le kit VIP est bien en chambre', 'check', 'Vérifier : bouteille de champagne, corbeille de fruits, mot de bienvenue personnalisé, peignoir premium.', NULL);

-- Procedure 2: Check-out
INSERT OR IGNORE INTO procedures (id, hotel_id, category_id, title, description, trigger_event, trigger_icon, priority, status, version, created_by, approved_by) VALUES
  (2, 1, 1, 'Check-out d''un client', 'Procédure de départ d''un client', 'Un client se présente à la réception pour régler et partir', 'fa-door-closed', 'normal', 'active', 1, 2, 2);

INSERT OR IGNORE INTO steps (id, procedure_id, step_number, title, description, step_type, details) VALUES
  (8, 2, 1, 'Demander le numéro de chambre', 'Identifier le client et sa réservation', 'action', 'PMS > Onglet "Départs du jour" > Rechercher par chambre ou nom'),
  (9, 2, 2, 'Vérifier les consommations', 'Vérifier le minibar et les extras non facturés', 'check', 'Appeler le housekeeping pour vérifier le minibar de la chambre. Vérifier les charges restaurant/bar/spa.'),
  (10, 2, 3, 'Présenter la facture', 'Imprimer et présenter le détail des charges', 'action', 'PMS > Facturation > Imprimer la facture détaillée. Présenter au client pour validation.'),
  (11, 2, 4, 'Procéder au paiement', 'Encaisser le solde restant', 'action', 'Si prépayé : vérifier le solde = 0. Sinon : encaisser par CB, espèces ou virement.'),
  (12, 2, 5, 'Récupérer la clé', 'Demander la restitution de la clé magnétique', 'action', 'Récupérer la clé et la désactiver dans le système.'),
  (13, 2, 6, 'Remercier et proposer un feedback', 'Demander si le séjour s''est bien passé', 'action', 'Remercier le client. Proposer de laisser un avis. Lui souhaiter un bon retour.');

-- Procedure 3: Plainte client
INSERT OR IGNORE INTO procedures (id, hotel_id, category_id, title, description, trigger_event, trigger_icon, priority, status, version, created_by, approved_by) VALUES
  (3, 1, 6, 'Gestion d''une plainte client', 'Comment gérer une réclamation ou plainte d''un client', 'Un client exprime une insatisfaction ou une plainte', 'fa-face-frown', 'high', 'active', 1, 2, 2);

INSERT OR IGNORE INTO steps (id, procedure_id, step_number, title, description, step_type, details, warning) VALUES
  (14, 3, 1, 'Écouter activement', 'Laisser le client s''exprimer sans interrompre', 'action', 'Maintenir un contact visuel, hocher la tête, reformuler pour montrer la compréhension.', 'Ne JAMAIS contredire le client ou minimiser sa plainte.'),
  (15, 3, 2, 'S''excuser sincèrement', 'Présenter des excuses au nom de l''hôtel', 'action', '"Je suis sincèrement désolé(e) pour ce désagrément, M./Mme [nom]. Ce n''est pas le niveau de service que nous souhaitons vous offrir."', NULL),
  (16, 3, 3, 'Proposer une solution', 'Offrir une résolution adaptée au problème', 'action', 'Solutions possibles : changement de chambre, réduction, service offert, upgrade. Adapter selon la gravité.', NULL),
  (17, 3, 4, 'Escalader si nécessaire', 'Contacter le responsable si la solution ne convient pas', 'escalation', 'Appeler le duty manager : poste 100. Si absent, le responsable de nuit : poste 101.', 'Ne JAMAIS laisser un client en attente plus de 10 minutes sans revenir vers lui.'),
  (18, 3, 5, 'Documenter la plainte', 'Enregistrer tous les détails dans le système', 'action', 'PMS > Section "Réclamations" > Nouvelle entrée. Noter : nom du client, chambre, nature de la plainte, solution proposée, résultat.', NULL),
  (19, 3, 6, 'Suivi post-résolution', 'Vérifier la satisfaction après résolution', 'action', 'Rappeler le client 1h après ou passer en chambre. S''assurer que le problème est résolu.', NULL);

-- Conditions for complaint
INSERT OR IGNORE INTO conditions (id, procedure_id, condition_text, description, sort_order) VALUES
  (4, 3, 'Le client est très en colère / agressif', 'Situation de conflit intense', 1),
  (5, 3, 'La plainte concerne un problème de sécurité ou santé', 'Urgence liée à la sécurité', 2);

INSERT OR IGNORE INTO condition_steps (id, condition_id, step_number, title, description, step_type, warning) VALUES
  (8, 4, 1, 'Rester calme et professionnel', 'Ne pas répondre à l''agressivité par l''agressivité', 'action', 'Si le client devient menaçant, alerter la sécurité immédiatement (poste 999).'),
  (9, 4, 2, 'Isoler la situation', 'Proposer de continuer la discussion dans un bureau privé', 'action', NULL),
  (10, 4, 3, 'Appeler immédiatement le responsable', 'Ne pas tenter de gérer seul une situation agressive', 'escalation', 'Contacter le duty manager IMMÉDIATEMENT.'),
  (11, 5, 1, 'Sécuriser le client', 'Mettre le client en sécurité immédiatement', 'action', 'Priorité absolue : la sécurité du client et des autres occupants.'),
  (12, 5, 2, 'Alerter les services concernés', 'Contacter maintenance/sécurité/urgences selon le cas', 'escalation', 'Incendie : 18. SAMU : 15. Police : 17. Maintenance urgente : poste 200.');

-- Procedure 4: Alarme incendie
INSERT OR IGNORE INTO procedures (id, hotel_id, category_id, title, description, trigger_event, trigger_icon, priority, status, version, created_by, approved_by) VALUES
  (4, 1, 5, 'Alarme incendie', 'Procédure d''urgence en cas de déclenchement de l''alarme incendie', 'L''alarme incendie se déclenche', 'fa-fire', 'critical', 'active', 1, 2, 2);

INSERT OR IGNORE INTO steps (id, procedure_id, step_number, title, description, step_type, details, warning) VALUES
  (20, 4, 1, 'Ne PAS paniquer', 'Rester calme et professionnel pour rassurer les clients', 'action', 'Prendre une grande respiration. Vous êtes formé pour cette situation.', 'Chaque seconde compte. Agissez vite mais avec calme.'),
  (21, 4, 2, 'Identifier la zone de déclenchement', 'Vérifier sur le panneau de contrôle incendie', 'check', 'Panneau incendie situé à la réception, derrière le comptoir. Identifier l''étage et la zone.', NULL),
  (22, 4, 3, 'Appeler les pompiers', 'Composer le 18 immédiatement', 'notification', 'Appeler le 18. Indiquer : adresse, nombre d''étages, nombre estimé d''occupants, zone du déclenchement.', 'Appeler les pompiers MÊME si c''est peut-être une fausse alerte.'),
  (23, 4, 4, 'Lancer l''évacuation', 'Déclencher la procédure d''évacuation', 'action', 'Activer l''alarme générale si pas déjà fait. Prendre le registre des occupants. Diriger vers les sorties de secours.', NULL),
  (24, 4, 5, 'Point de rassemblement', 'Diriger tout le monde vers le point de rassemblement', 'action', 'Point de rassemblement : parking arrière, zone B. Compter les personnes. Vérifier avec le registre.', NULL);

-- Procedure 5: Nettoyage chambre
INSERT OR IGNORE INTO procedures (id, hotel_id, category_id, title, description, trigger_event, trigger_icon, priority, status, version, created_by, approved_by) VALUES
  (5, 1, 2, 'Nettoyage chambre après départ', 'Procédure de remise en état d''une chambre après le check-out', 'Le client a quitté la chambre (check-out effectué)', 'fa-spray-can-sparkles', 'normal', 'active', 1, 2, 2);

INSERT OR IGNORE INTO steps (id, procedure_id, step_number, title, description, step_type, details, tip) VALUES
  (25, 5, 1, 'Vérifier le statut dans le PMS', 'Confirmer que le client a bien fait le check-out', 'check', 'PMS > Housekeeping > Vérifier statut "Départ effectué" pour la chambre.', NULL),
  (26, 5, 2, 'Inspection initiale', 'Vérifier objets oubliés et état général', 'check', 'Vérifier : objets oubliés (coffre-fort, salle de bain, penderie), dégâts éventuels, minibar.', 'Si objet oublié trouvé, le déposer immédiatement à la réception avec le numéro de chambre.'),
  (27, 5, 3, 'Aérer la chambre', 'Ouvrir les fenêtres pendant le nettoyage', 'action', 'Ouvrir les fenêtres en grand. Tirer les rideaux.', NULL),
  (28, 5, 4, 'Retirer le linge sale', 'Draps, serviettes, peignoirs', 'action', 'Retirer tout le linge. Le placer dans le chariot de linge sale. Trier par type.', NULL),
  (29, 5, 5, 'Nettoyer la salle de bain', 'Nettoyage complet de la salle de bain', 'action', 'Ordre : WC, lavabo, douche/baignoire, miroir, sol. Replacer les produits d''accueil neufs.', NULL),
  (30, 5, 6, 'Faire le lit', 'Lit fait selon le standard de l''hôtel', 'action', 'Drap housse > drap plat > couverture > couvre-lit. Oreillers gonflés et alignés.', NULL),
  (31, 5, 7, 'Nettoyer la chambre', 'Dépoussiérage, aspiration, surfaces', 'action', 'Dépoussiérer toutes les surfaces. Aspirer. Nettoyer les vitres si nécessaire. Vider les poubelles.', NULL),
  (32, 5, 8, 'Réapprovisionner', 'Minibar, fournitures, documents', 'action', 'Minibar complet, papeterie, télécommande en place, livret d''accueil, stylo, bloc-notes.', NULL),
  (33, 5, 9, 'Inspection finale', 'Vérification complète avant validation', 'check', 'Tour de la chambre : éclairage fonctionnel, TV ok, clim ok, coffre-fort réinitialisé, pas d''odeur.', NULL),
  (34, 5, 10, 'Mettre à jour le PMS', 'Passer la chambre en statut "Propre - Inspectée"', 'action', 'PMS > Housekeeping > Chambre > Statut "Propre". Signaler tout dégât éventuel.', NULL);

-- Some suggestions
INSERT OR IGNORE INTO suggestions (id, hotel_id, procedure_id, user_id, type, title, description, status) VALUES
  (1, 1, 1, 3, 'improvement', 'Ajouter un SMS de bienvenue', 'Proposer d''envoyer un SMS au client avec les infos pratiques (WiFi, petit-déjeuner) juste après le check-in pour qu''il les ait sur son téléphone.', 'pending'),
  (2, 1, 5, 4, 'improvement', 'Checklist photo pour le nettoyage', 'Prendre une photo de la chambre après nettoyage pour validation par le superviseur, surtout pour les suites.', 'pending'),
  (3, 1, NULL, 3, 'new_procedure', 'Procédure pour les room service', 'Il manque une procédure détaillée pour le room service : prise de commande, préparation, livraison, récupération du plateau.', 'pending');

-- Changelog entries
INSERT OR IGNORE INTO changelog (id, hotel_id, procedure_id, user_id, action, summary, is_read_required) VALUES
  (1, 1, 1, 2, 'created', 'Procédure de check-in créée avec toutes les étapes et conditions', 0),
  (2, 1, 2, 2, 'created', 'Procédure de check-out créée', 0),
  (3, 1, 3, 2, 'activated', 'Procédure de gestion des plaintes activée et obligatoire pour tout le personnel', 1),
  (4, 1, 4, 2, 'activated', 'URGENT : Nouvelle procédure incendie mise à jour - LECTURE OBLIGATOIRE', 1);

-- Templates (created by super_admin)
INSERT OR IGNORE INTO templates (id, name, description, category_name, trigger_event, steps_json, created_by) VALUES
  (1, 'Check-in Standard', 'Template de base pour le check-in client', 'Réception', 'Un client arrive pour s''enregistrer', '[{"step_number":1,"title":"Accueillir le client","description":"Saluer avec le sourire","step_type":"action"},{"step_number":2,"title":"Vérifier la réservation","description":"Rechercher dans le PMS","step_type":"action"},{"step_number":3,"title":"Vérifier l''identité","description":"Demander pièce d''identité","step_type":"check"},{"step_number":4,"title":"Paiement","description":"Prendre empreinte CB","step_type":"action"},{"step_number":5,"title":"Remettre la clé","description":"Programmer et remettre la clé","step_type":"action"}]', 1),
  (2, 'Gestion de plainte', 'Template pour la gestion des réclamations', 'Relations Clients', 'Un client fait une réclamation', '[{"step_number":1,"title":"Écouter","description":"Écouter sans interrompre","step_type":"action"},{"step_number":2,"title":"S''excuser","description":"Présenter des excuses sincères","step_type":"action"},{"step_number":3,"title":"Résoudre","description":"Proposer une solution","step_type":"action"},{"step_number":4,"title":"Documenter","description":"Enregistrer la plainte","step_type":"action"},{"step_number":5,"title":"Suivre","description":"Vérifier la satisfaction","step_type":"action"}]', 1),
  (3, 'Procédure d''urgence incendie', 'Template pour la procédure incendie', 'Sécurité', 'L''alarme incendie se déclenche', '[{"step_number":1,"title":"Garder son calme","description":"Rester calme et professionnel","step_type":"action"},{"step_number":2,"title":"Identifier la zone","description":"Vérifier le panneau de contrôle","step_type":"check"},{"step_number":3,"title":"Appeler les pompiers","description":"Composer le 18","step_type":"notification"},{"step_number":4,"title":"Évacuer","description":"Lancer l''évacuation","step_type":"action"},{"step_number":5,"title":"Rassemblement","description":"Point de rassemblement","step_type":"action"}]', 1);
