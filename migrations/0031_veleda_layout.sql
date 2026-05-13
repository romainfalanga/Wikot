-- Ajout des colonnes de positionnement / dimensionnement des notes Veleda
-- pos_x / pos_y : position en pixels dans le tableau (origine = coin haut-gauche du board)
-- width / height : taille de la note en pixels
-- Toutes optionnelles : NULL = placement auto-calcule cote client a la creation

ALTER TABLE veleda_notes ADD COLUMN pos_x INTEGER;
ALTER TABLE veleda_notes ADD COLUMN pos_y INTEGER;
ALTER TABLE veleda_notes ADD COLUMN width INTEGER;
ALTER TABLE veleda_notes ADD COLUMN height INTEGER;
