# Marseille BB

Prototype navigateur solo dans une zone geographique reelle autour du Vieux-Port. Les routes et empreintes de batiments du quartier sont extraites d'OpenStreetMap, reprojetees en coordonnees locales en metres, puis extrudees en 3D. La mini-carte et le nom de rue proche utilisent le meme extrait. Les accessoires destructibles, l'avatar, les effets et la police restent des elements fictifs et arcade.

## Jouer localement

Prerequis : Node.js 24 ou plus recent.

```sh
npm install
npm run dev
```

Le script `predev` genere `public/maps/vieux-port.json` depuis l'extrait OSM fourni. Ouvrir l'URL affichee par Vite.

Pour verifier le build de production :

```sh
npm test
npm run build
npm run preview
```

## Commandes

- **ZQSD ou WASD** : se deplacer; **Maj** : sprinter.
- **Souris maintenue et glissee sur la scene** : orienter la camera; molette : zoom.
- **Espace** : sauter.
- **E** ou **clic gauche sur la scene** : impulsion arcade qui projette les accessoires fictifs a proximite.
- **Echap** : ouvrir ou fermer la pause.

Les accessoires reapparaissent apres quelques secondes. Les destructions accordent des points, prolongent un combo et augmentent l'indice de recherche; les voitures de patrouille-jouets poursuivent le personnage. Une capture penalise le score puis replace le personnage dans le quartier. Le bouton du son active/desactive un effet genere par le navigateur; les autres boutons servent a reprendre, mettre en pause ou recommencer.

## Donnees geographiques

La zone test couvre le Vieux-Port et des rues voisines (bbox WGS84 5.366,43.2905,5.382,43.301). Le fichier `data/osm/vieux-port.osm.gz` est un extrait OpenStreetMap versionne pour que les builds soient reproductibles sans dependre d'un service externe. Le generateur simplifie les geometries, projette longitude/latitude en metres, extrait les routes nommees et genere des empreintes de batiments extrudables. La hauteur vient des tags `height` ou `building:levels` lorsqu'ils existent; a defaut, une hauteur procedurale indicative est utilisee. Ce n'est pas une reconstruction photorealiste, un MNT/relief ou une ville de 100 km².

```sh
npm run map:generate
npm run map:update
```

`map:generate` reconstruit le JSON de jeu depuis l'extrait local. `map:update` telecharge un nouvel extrait depuis l'API OpenStreetMap, remplace le fichier source compresse puis regenere le JSON. La mise a jour requiert une connexion au service OSM et peut etre soumise a ses limites de debit.

Donnees © OpenStreetMap contributors, distribuees sous licence ODbL-1.0. Attribution et informations de licence : https://www.openstreetmap.org/copyright. Le code du prototype ne relicencie pas la base de donnees OSM.

## Perimetre

Cette version comprend la zone test OSM du Vieux-Port, ses routes et empreintes de batiments, les volumes 3D stylises, les collisions simplifiees, le nom de rue proche, une mini-carte, le deplacement/camera tiers personne, les accessoires destructibles, le score, les combos et une poursuite policiere arcade non violente.

Le monde de 100 km², le streaming de tuiles, les donnees altimetriques IGN, les interieurs, les commerces interactifs, les vehicules pilotables, les missions, la progression, les comptes et le multijoueur (jusqu'a 32 joueurs) ne sont pas implementes. GitHub Pages publie uniquement le client solo. Aucun bouton ne pretend offrir les fonctions absentes.

## Scripts et publication

- `npm run dev` : serveur local (genere la carte avant le lancement).
- `npm test` : tests des regles arcade et du convertisseur OSM.
- `npm run build` : generation des donnees geographiques, verification TypeScript et build.
- `npm run preview` : servir le build localement.

Le workflow GitHub Actions execute les tests et le build puis publie le client statique sur GitHub Pages.
