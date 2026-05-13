-- Migration 0033 : couleur d'importance sur les notes Veleda + emoji-icone par user
--
-- 1) veleda_notes.color : importance du message (priorite/criticite)
--    'green' = info peu importante (defaut)
--    'black' = info intermediaire
--    'red'   = info capitale
--
-- 2) users.emoji : emote-icone choisi par l'utilisateur (visible sur la legende
--    du tableau Veleda pour identifier l'auteur de chaque note).
--    NULL = pas encore choisi (on affichera une icone par defaut).

ALTER TABLE veleda_notes ADD COLUMN color TEXT NOT NULL DEFAULT 'black';
ALTER TABLE users ADD COLUMN emoji TEXT;
