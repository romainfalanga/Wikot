-- Migration 0034 : police d'ecriture par note Veleda
--
-- L'utilisateur choisit a la creation parmi 10 polices manuscrites (whitelist
-- serveur cote backend, validee). La valeur stockee est le nom canonique de
-- la famille Google Fonts (ex: 'Kalam', 'Permanent Marker', ...).
-- Defaut = 'Kalam' (police mediane, lisible).

ALTER TABLE veleda_notes ADD COLUMN font TEXT NOT NULL DEFAULT 'Kalam';
