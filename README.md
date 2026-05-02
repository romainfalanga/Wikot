# Wikot - Gestion intelligente des procédures hôtelières

## Concept
Wikot fonctionne comme un système d'automatisation IF/THEN appliqué aux procédures hôtelières :
- **TRIGGER** : "Qu'est-ce qu'il se passe ?" (le déclencheur)
- **STEPS** : "Qu'est-ce que je dois faire ?" (les étapes à suivre)
- **CONDITIONS** : "Et si en plus..." (les cas spécifiques)

## Objectifs
- **Faciliter la prise de poste** des nouveaux employés avec toutes les procédures accessibles
- **Centraliser les procédures** pour les responsables d'hôtel
- **Gérer les changements** de procédures avec notification obligatoire
- **Permettre les suggestions** d'amélioration par les employés
- **Créer des templates** réutilisables par le super admin

## Rôles utilisateurs

| Rôle | Permissions |
|------|-----------|
| **Super Admin** (Romain) | Créer des templates, gérer les hôtels, vue globale |
| **Admin** (Responsable hôtel) | CRUD procédures, valider suggestions, gérer employés |
| **Employé** | Consulter procédures, rechercher, proposer suggestions |

## URLs
- **App** : https://3000-ikc3f6798ke5uiecvnuqp-de59bda9.sandbox.novita.ai

## Comptes de démonstration
| Email | Rôle | Mot de passe |
|-------|------|-------------|
| romain@wikot.app | Super Admin | demo123 |
| marie@grandparis.com | Admin Hôtel | demo123 |
| jean@grandparis.com | Employé | demo123 |

## Fonctionnalités implémentées
- [x] Authentification par rôle (super_admin, admin, employee)
- [x] Dashboard adapté au rôle
- [x] CRUD complet des procédures (trigger + steps + conditions)
- [x] Vue arborescence par catégories
- [x] Recherche de procédures par mots-clés
- [x] Système de suggestions (employés proposent, admins valident)
- [x] Historique des changements avec lecture obligatoire
- [x] Templates créés par le super admin, importables par les hôtels
- [x] Gestion multi-hôtels
- [x] Gestion des utilisateurs
- [x] Données de démo (5 procédures complètes pour l'hôtel Le Grand Paris)

## Architecture technique
- **Backend** : Hono (TypeScript) sur Cloudflare Workers
- **Base de données** : Cloudflare D1 (SQLite)
- **Frontend** : Vanilla JS + Tailwind CSS + FontAwesome
- **Déploiement** : Cloudflare Pages

## Structure de la base de données
- `hotels` : Hôtels enregistrés
- `users` : Utilisateurs avec rôles
- `categories` : Catégories de procédures (Réception, Housekeeping, etc.)
- `procedures` : Procédures avec trigger, priorité, statut
- `steps` : Étapes d'une procédure
- `conditions` : Cas spécifiques / branches conditionnelles
- `condition_steps` : Étapes spécifiques à une condition
- `suggestions` : Suggestions d'amélioration des employés
- `changelog` : Historique des modifications
- `changelog_reads` : Accusés de lecture
- `templates` : Templates de procédures (super admin)

## API Endpoints

### Auth
- `POST /api/auth/login` — Connexion
- `GET /api/auth/me` — Utilisateur courant

### Procedures
- `GET /api/procedures` — Liste (filtres: hotel_id, category_id, status, search)
- `GET /api/procedures/:id` — Détail complet (steps + conditions)
- `POST /api/procedures` — Créer
- `PUT /api/procedures/:id` — Modifier
- `PUT /api/procedures/:id/status` — Changer le statut
- `DELETE /api/procedures/:id` — Supprimer

### Categories, Suggestions, Changelog, Users, Hotels, Templates
- CRUD complet disponible pour chaque ressource

## Prochaines étapes recommandées
- [ ] Hashage des mots de passe (bcrypt/argon2)
- [ ] Sessions JWT avec expiration
- [ ] Export PDF des procédures
- [ ] Mode hors-ligne (PWA)
- [ ] Notifications push pour les changements
- [ ] Drag & drop pour réordonner les étapes
- [ ] Historique des versions de chaque procédure
- [ ] Intégration IA pour générer des procédures
- [ ] Recherche avancée avec filtres combinés
- [ ] Statistiques d'utilisation (quelles procédures sont les plus consultées)
