# Marseille BB

Prototype navigateur solo, original et jouable, dans un quartier mediterraneen fictif inspire du Vieux-Port. La scene, les personnages, les batiments, les objets, les textures et les effets sont generes localement par le code : aucun modele, logo, son ou contenu tiers n'est requis.

## Lancer le jeu

Prerequis : Node.js 20 ou plus recent.

```sh
npm install
npm run dev
```

Ouvrir l'URL affichee par Vite. Pour verifier la version de production :

```sh
npm test
npm run build
npm run preview
```

## Commandes

- **ZQSD ou WASD** : se deplacer; **Maj** : sprinter.
- **Souris maintenue et glissee sur la scene** : orienter la camera; molette : zoom.
- **Espace** : sauter.
- **E** ou **clic gauche sur la scene** : impulsion arcade qui projette les accessoires destructibles a proximite.
- **Echap** : ouvrir ou fermer la pause.

Les accessoires reapparaissent apres quelques secondes. Les destructions accordent des points, prolongent un combo et augmentent l'indice de recherche; les voitures de patrouille de style jouet poursuivent le personnage. Une capture penalise le score puis replace le personnage dans le quartier. Le bouton du son active/desactive un petit effet sonore genere par le navigateur; les autres boutons servent a reprendre, mettre en pause ou recommencer.

## Perimetre

Cette tranche couvre le prototype solo V0.1 a V0.3 : camera a la troisieme personne, deplacements, quartier original, accessoires destructibles, score, combos et poursuite policiere arcade non violente. La physique est une impulsion arcade maison avec des particules, et non un moteur de simulation realiste.

Il n'y a pas de serveur ni de multijoueur, de comptes, de sauvegarde, de vehicules pilotables, de missions, de progression persistante, de chat ou de deploiement configure. Aucun bouton ne pretend offrir ces fonctions. Les passants, les armes et les destructions de personnes sont absents; seuls des accessoires fictifs sont affectes.

## Scripts

- `npm run dev` : serveur local Vite.
- `npm test` : tests unitaires des regles de score, combo et indice.
- `npm run build` : verification TypeScript et build de production.
- `npm run preview` : servir le build localement.
