-- ============================================
-- 0005 — Seed Hotel Info pour Grand Hôtel des Lecques (hotel_id = 1)
-- ============================================

-- Catégories (8 grandes catégories)
INSERT INTO hotel_info_categories (id, hotel_id, name, icon, color, sort_order) VALUES
  (1, 1, 'Informations pratiques', 'fa-circle-info', '#3B82F6', 1),
  (2, 1, 'Chambres & Salles de bains', 'fa-bed', '#8B5CF6', 2),
  (3, 1, 'Services de l''hôtel', 'fa-concierge-bell', '#F59E0B', 3),
  (4, 1, 'Linge & Confort', 'fa-shirt', '#EC4899', 4),
  (5, 1, 'Restauration', 'fa-utensils', '#EF4444', 5),
  (6, 1, 'Loisirs & Activités', 'fa-water-ladder', '#10B981', 6),
  (7, 1, 'Télévision', 'fa-tv', '#6366F1', 7),
  (8, 1, 'Best Western & Fidélité', 'fa-star', '#D97706', 8);

-- ============================================
-- 1. Informations pratiques
-- ============================================
INSERT INTO hotel_info_items (hotel_id, category_id, title, content, sort_order) VALUES
(1, 1, 'Parking', 'Parking de l''hôtel gratuit, non sécurisé, pour les clients de l''hôtel.', 1),
(1, 1, 'Bornes électriques', 'Des bornes de recharge électriques sont disponibles, sur réservations, en supplément.

Tarif : 15€ par créneaux de 4 heures.', 2),
(1, 1, 'Arrivées (Check-in)', 'Les check-in se font à partir de 16h00.', 3),
(1, 1, 'Départ (Check-out)', 'Merci de libérer votre chambre avant 12h.

Si vous souhaitez un départ tardif, nous vous prions de contacter la réception (selon disponibilités et avec un supplément).', 4),
(1, 1, 'Départ express', 'Pour vos départs express, il est possible de réaliser un express check-out afin de limiter votre attente lors de votre départ.

Demandez à la réception comment procéder.', 5),
(1, 1, 'Paiement', 'L''hôtel accepte les cartes de crédit suivantes : Visa, MasterCard, Chèques ANCV Papier, Amex, Espèces, Les Chèques cadeaux Références Best Western®.

⚠️ Les paiements par chèque ne sont pas acceptés.', 6),
(1, 1, 'Facture', 'Votre facture est consultable sur simple demande auprès de la réception. En cas de séjour excédant 7 nuits, un paiement hebdomadaire sera exigé.

Le solde de votre facture est à régler le jour de votre départ.', 7),
(1, 1, 'Express check-out', 'Facilité de départ sans attente !', 8),
(1, 1, 'Souvenirs', 'Votre chambre est décorée et équipée pour votre bien-être avant l''arrivée de chaque hôte.

Si vous souhaitez acquérir un des objets ou équipements, il vous sera facturé.

Nous mettons à la vente des toutas entre 15€ et 23€, des carafes d''eau GHL au tarif de 10€, etc.', 9),
(1, 1, 'Nos établissements', 'Consultez notre site internet GROUPE CAP CANAILLE pour vos prochains séjours à :
• Cassis
• La Ciotat
• Saint-Cyr-sur-Mer
• Moissac', 10);

-- ============================================
-- 2. Chambres & Salles de bains
-- ============================================
INSERT INTO hotel_info_items (hotel_id, category_id, title, content, sort_order) VALUES
(1, 2, 'Équipements', 'Votre chambre est équipée et entretenue pour votre confort. Les équipements présents sont à votre disposition tout au long de votre séjour.

⚠️ Toute dégradation sera facturée en fonction du montant estimé du préjudice subi par l''hôtel.', 1),
(1, 2, 'Fumeurs', 'Cette chambre est non-fumeur. Merci de le respecter.

Si vous souhaitez fumer sur votre balcon, merci de demander à notre équipe un cendrier.', 2),
(1, 2, 'Chauffage & Climatisation', 'L''hôtel est équipé d''un système réversible de chauffage/climatisation.', 3),
(1, 2, 'Électricité', 'Toutes les prises sont alimentées 24h/24 en 220V.', 4),
(1, 2, 'Environnement', 'Pensez à éteindre les lumières et le téléviseur, à fermer la fenêtre et à enlever la carte clé de votre chambre, lorsque vous sortez.

En nous choisissant, vous faites travailler les commerces et associations locales. L''eau est précieuse, utiliser vos serviettes, draps de bains et draps plusieurs fois.

Un économiseur d''énergie est présent dans chaque chambre.', 5),
(1, 2, 'Adaptateurs', 'Des adaptateurs sont disponibles à la réception sur demande.

⚠️ Une caution de 25€ sera portée sur votre facture jusqu''à restitution auprès de la réception.', 6),
(1, 2, 'Coffre-fort', 'Dans le placard de votre chambre, vous trouverez un coffre-fort. Déposez-y vos objets de valeur ainsi que vos papiers d''identité et vos moyens de paiement afin de les conserver en toute sécurité.', 7),
(1, 2, 'Mini-bar : Snacks & Boissons', 'Un mini bar est à disposition dans votre chambre avec des snacks salés et sucrés, eau et autres boissons.

Complétez la fiche et remettez-la à la réception lors de votre départ.', 8),
(1, 2, 'Maintenance', 'Merci de nous signaler tout problème ou dysfonctionnement.

Nous nous engageons à le solutionner dans les plus brefs délais.', 9),
(1, 2, 'Bouteille d''eau', 'Une bouteille d''eau vous est offerte gracieusement le jour de votre arrivée.', 10);

-- ============================================
-- 3. Services de l'hôtel
-- ============================================
INSERT INTO hotel_info_items (hotel_id, category_id, title, content, sort_order) VALUES
(1, 3, 'Carte clé', 'Conservez votre carte de chambre avec vous durant votre séjour.', 1),
(1, 3, 'Bagagerie', 'Une bagagerie est disponible. N''hésitez pas à vous adresser à la réception ouverte 7j/7 et 24h/24.', 2),
(1, 3, 'Conciergerie', 'Notre équipe de réception est à votre entière disposition pour vous accompagner dans la découverte de Saint-Cyr-sur-Mer et de ses environs pendant votre séjour.

Vous pouvez également retrouver toutes nos recommandations plus bas dans votre lecture.', 3),
(1, 3, 'Bureau / Photocopies', 'Un service de photocopies est disponible 24h/24 à la réception.

Les tarifs sont disponibles sur demande à la réception.', 4),
(1, 3, 'Service bébé', 'Chaise bébé, rehausseur, lit bébé, chauffe biberon, table à langer et baignoires sont à votre disposition gratuitement sur demande à la réception.

Pour un service de garde d''enfant, merci de contacter la réception.', 5),
(1, 3, 'Fer à repasser', 'Des planches et fers à repasser sont disponibles sur simple demande auprès de la réception ou du service d''étages.', 6),
(1, 3, 'Parapluie', 'Des parapluies sont disponibles à la réception.

⚠️ Une caution de 10,00€ sera portée sur votre facture jusqu''à restitution auprès de la réception.', 7),
(1, 3, 'Transports', 'Réservation taxis à la réception (pour aéroport et gare, réservation 24h avant votre départ).

Informations sur les transports durables à la réception.', 8),
(1, 3, 'Séminaires & Événements privés', 'Banquets, Mariages, et Réceptions Privées.

Contact, capacité et disponibilité des salles sur demande à la réception ou auprès de notre service commercial.

📧 groupes@hotels-capcanaille.com', 9),
(1, 3, 'Mywo (Coworking)', 'Notre espace de coworking sur-mesure est disponible au sein de notre établissement.

Connexion haut débit et possibilité d''impression sont gracieusement mis à votre disposition.

Horaires : 7j/7 - 24h/24', 10);

-- ============================================
-- 4. Linge & Confort
-- ============================================
INSERT INTO hotel_info_items (hotel_id, category_id, title, content, sort_order) VALUES
(1, 4, 'Produits d''accueil', 'Un kit oubli ?

Un ensemble de produits de toilette est disponible gratuitement en réception : kit rasage et dentaire, peigne, kit couture, protections périodiques, serviettes, peignoirs, chaussons, vanity kit, kit de secours de voyage…

La réception est en mesure de vous communiquer les informations utiles pour vous procurer ce produit.', 1),
(1, 4, 'Linge', 'Vos draps sont changés 1 jour sur 3 pendant votre séjour.

Si vous souhaitez un remplacement quotidien de votre linge de lit, merci d''en informer la réception.

💡 Si vous êtes membres Best Western, gagnez 500 points si vous acceptez que le ménage soit fait 1 jour sur 3.', 2),
(1, 4, 'Serviettes & Piscine', 'Vos serviettes de piscines sont changées 1 jour sur 3 pendant votre séjour.

Si vous souhaitez un remplacement plus fréquent, ces dernières seront facturées 3€ par serviettes.', 3),
(1, 4, 'Literie', 'Des couvertures et oreillers supplémentaires sont disponibles gratuitement sur demande en réception.', 4),
(1, 4, 'Lits supplémentaires', 'Des lits supplémentaires sont disponibles, à la réservation, selon disponibilités, au tarif de 30€ (gratuit pour les moins de six ans).', 5),
(1, 4, 'Sèche-cheveux', 'Un sèche-cheveux est à votre disposition dans votre salle de bain.', 6);

-- ============================================
-- 5. Restauration
-- ============================================
INSERT INTO hotel_info_items (hotel_id, category_id, title, content, sort_order) VALUES
(1, 5, 'Petit-déjeuner', 'En Buffet : tous les jours de 07h00 à 10h30 dans la salle du restaurant "Le 1896".

Une large sélection de produits sucrés, salés, de fruits frais ainsi que de produits régionaux vous sont proposés aux tarifs de :
• 19€ par jour et par personne (à partir de 12 ans)
• 10€ par jour et par enfant (de 6 à 11 ans)
• Gratuit pour les enfants de moins de 6 ans

🛏️ En room service : petit-déjeuner en chambre disponible sur demande, en remplissant la cravate et en l''accrochant avant 00h00 à votre porte, au tarif de 21€.

⚡ Petit déjeuner express : nous vous proposons 1 boisson chaude, 2 viennoiseries, 1 jus de fruit et 1 fruit frais, au tarif de 10€.

À commander la veille et à récupérer de 05h00 à 10h00.', 1),
(1, 5, 'Déjeuner', 'Servi au restaurant "Le 1896" de 12h00 à 14h00.

Du 1er mai au 14 juin 2026, ouvert le Lundi de Pentecôte.

⚠️ (Fermeture hebdomadaire : les Lundis, ouvert le Lundi de Pentecôte)', 2),
(1, 5, 'Brunch', 'Brunch au restaurant "La Pinède" de 11h00 à 15h00.

À compter du 28 juin, tous les 15 jours jusqu''au 20 septembre 2026 (inclus).', 3),
(1, 5, 'Dîner', 'Servi au restaurant "La Pinède" de 12h00 à 15h00 :
• Du 1er mai au 14 juin 2026, ouvert samedi et dimanche uniquement
• Du 15 juin au 31 août, ouvert tous les jours

Servi au restaurant "Le 1896" de 19h00 à 22h00 :
• Du 21 avril au 14 juin 2026, et septembre, tous les soirs sauf les Dimanches et les Lundis soir
• Du 15 juin au 31 août 2026, tous les soirs
• Les jeudis soirs - Soirées musicales à La Pinède (dates à venir)

⚠️ Une petite carte d''encas sera disponible pendant les heures de fermeture du restaurant.', 4),
(1, 5, 'Bar', 'Ouvert de 15h00 à 23h00.

Le bar de la piscine est ouvert de 15h00 à 18h00 (sur la saison estivale, juillet et août).', 5);

-- ============================================
-- 6. Loisirs & Activités
-- ============================================
INSERT INTO hotel_info_items (hotel_id, category_id, title, content, sort_order) VALUES
(1, 6, 'Piscine', 'Ouverte de 09h00 à 20h00. Piscine extérieure non chauffée.

Profondeur minimale 0.80cm et profondeur maximale 2.10m.', 1),
(1, 6, 'Tennis', 'Ouverts de 09h00 à 21h00.

⚠️ Une caution de 50€ sera portée sur votre facture jusqu''à restitution auprès de la réception.', 2),
(1, 6, 'Boulodrome', 'Ouvert de 10h00 à 19h00.

⚠️ Une caution de 50€ sera portée sur votre facture jusqu''à restitution auprès de la réception.', 3),
(1, 6, 'Rooftop', 'Ouvert tous les Dimanches, de Juin à Septembre 2026.

Retraite pilates / yoga de 09h30 à 13h00.

ℹ️ Sur réservations et sous réserve d''un minimum de participants.', 4),
(1, 6, 'Jacuzzi — Procédure d''utilisation', '1️⃣ **Procédure d''utilisation**
• Débâcher le jacuzzi avant utilisation
• Appuyer sur « Lock » pour déverrouiller les commandes, puis "Preheat" pour démarrer
• Utiliser les fonctions souhaitées via le panneau de contrôle
• Après utilisation, rebâcher soigneusement le jacuzzi

2️⃣ **Conditions d''accès**
L''utilisation des jacuzzis est strictement interdite :
• Aux enfants de moins de 16 ans
• Aux femmes enceintes
• Aux personnes fragiles (notamment souffrant de problèmes cardiaques, respiratoires ou de santé sensibles)

3️⃣ **Règles d''hygiène**
• La douche est obligatoire avant chaque utilisation
• Merci d''entrer dans le jacuzzi avec une tenue de bain propre

4️⃣ **Température de l''eau**
La température maximale recommandée est de 35°C.

5️⃣ **Durée d''utilisation**
• La durée d''utilisation recommandée est de 20 minutes maximum par session
• Faire une pause avant toute nouvelle utilisation

6️⃣ **Consignes techniques importantes**
⚠️ Ne pas appuyer sur le bouton ON/OFF, afin de garantir le maintien de la température.
⚠️ Ne pas toucher :
• La vanne de vidange bleue
• Le mitigeur

7️⃣ **Produits interdits**
Il est strictement interdit d''ajouter dans l''eau :
• Huiles
• Savons
• Mousses ou tout autre produit

8️⃣ **Consignes générales**
• Respecter le calme et la tranquillité des autres clients
• Ne pas utiliser les jacuzzis en cas de fatigue importante
• En cas de problème technique ou de besoin, contacter la réception', 5);

-- ============================================
-- 7. Télévision
-- ============================================
INSERT INTO hotel_info_items (hotel_id, category_id, title, content, sort_order) VALUES
(1, 7, 'Chaînes nationales', 'TF1
France 2
France 3
France 5
M6
ARTE
C8
W9
TMC
TFX
NRJ12
LCP
FR4
BFMTV
CNEWS
CSTAR
GULLI
TF1 SERIES FILMS
L''EQUIPE
6TER
RMC STORY
RMC DECOUVERTE
CHERIE 25
LCI
France INFO
BFM TOULON VAR', 1),
(1, 7, 'Chaînes internationales', 'BLOOMBERG EUROPE TV (English HD)
CNN INT
BBC NEWS
3 SAT
RTL AUSTRIA
SUPER RTL A
CUBAVISION INTERNATIONAL
RAI NEWS 24
RAI 1
RAI 2
RAI NEWS
TVE INTERNATIONAL
24H
TVGA EUROPA
EUROSPORT 1 DEUTSCHLAND
ZDF', 2),
(1, 7, 'Chaînes supplémentaires', 'Des chaînes supplémentaires sont disponibles, à la réservation, selon disponibilités, au tarif de 30€.

(Gratuit pour les moins de six ans)', 3);

-- ============================================
-- 8. Best Western & Fidélité
-- ============================================
INSERT INTO hotel_info_items (hotel_id, category_id, title, content, sort_order) VALUES
(1, 8, 'Best Western® Hotels & Resorts', 'Best Western® Hotels & Resorts, c''est plus de 4000 hôtels dans le monde dont 300 établissements 3 étoiles, 4 étoiles et 5 étoiles en France.

Chaque hôtel Best Western® Hotels & Resorts singulier, propre et confortable offre un accueil chaleureux et une décoration personnelle et qualitative pour des séjours avec un bon rapport qualité prix.', 1),
(1, 8, 'Programme Fidélité — Best Western Rewards', 'Best Western Rewards® : chaque séjour est gagnant dans plus de 4000 hôtels dans le monde !

Rejoignez le club de fidélité Best Western Rewards® et profitez de nuits gratuites en cumulant des points dès votre premier séjour.

**5 statuts pour récompenser votre fidélité :**

🔵 **Blue** (10 points / 1€ dépensé)
• Cumulez des points dès votre premier séjour
• Accès à la boutique cadeau en ligne
• Jusqu''à 10% de réduction

🟡 **Gold** (11 points / 1€ dépensé)
• Dès 5 nuits, devenez client Gold
• Facilités de check-in / check-out
• Surclassements selon disponibilités
• Points bonus offerts à chaque séjour

⚪ **Platinum** (11,5 points / 1€ dépensé)
• Dès 7 nuits, devenez client Platinum
• Facilités de check-in / check-out
• Surclassements selon disponibilités
• Points bonus supplémentaires

🔘 **Diamond** (13 points / 1€ dépensé)
• Dès 15 nuits, devenez client Diamond
• Facilités de check-in / check-out
• Surclassements selon disponibilités
• Points bonus supplémentaires

⚫ **Diamond Select** (15 points / 1€ dépensé)
• Dès 25 nuits, nous réservons le meilleur
• Facilités de check-in / check-out
• Surclassements selon disponibilités
• Points bonus supplémentaires', 2);
