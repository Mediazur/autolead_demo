-- Réglages du parcours de commande, par compte (éditables depuis l'admin) :
-- version du parcours (par objectif / classique), textes des cartes objectif,
-- textes des formules, étapes « Ce qui se passe ensuite », options.
-- NULL = réglages par défaut du portail.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS order_settings JSONB;
