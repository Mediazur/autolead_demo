# Sauvegarde — version d'avant le parcours de commande par objectif (24/09/2026)

Ce dossier contient la version du portail telle qu'elle était en ligne avant
l'arrivée du parcours de commande par objectif :

- `public/index.html` : le portail (front)
- `api/index.js` : l'API (back)

## Revenir en arrière

**Option 1 — sans rien redéployer (recommandé)** : dans l'admin AutoLead, ouvrir
le compte → « Gérer le parcours de commande » → Version du parcours →
« Configurateur en étapes (ancienne version) » → Enregistrer. Le client retrouve
l'ancien configurateur à sa prochaine connexion. Réglable compte par compte.

**Option 2 — revenir entièrement à l'ancienne version du code** : remplacer
`public/index.html` et `api/index.js` à la racine du dépôt par les fichiers de ce
dossier, puis committer. La version est aussi marquée dans git par le tag
`avant-parcours-objectif`.

La colonne `order_settings` ajoutée en base n'a pas besoin d'être retirée :
l'ancienne version l'ignore simplement.
