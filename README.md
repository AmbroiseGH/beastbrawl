# Beast Brawl!

Jeu de combat d'animaux en 2D, au format portrait, jouable dans le navigateur et installable sur téléphone.
Un jeu Michigan.

**Jouer :** https://ambroisegh.github.io/beastbrawl/

## Le jeu

Des combats d'animaux en temps réel, à la manière de Clash Royale.

1. Chaque combat dure 3 minutes. Tu as une main de 4 cartes tirées de ton deck de 8. Glisse une carte sur ton côté
   de l'arène pour poser l'animal : chaque carte coûte de l'**Aura** (la partie commence avec 5, la jauge se recharge
   toute seule, deux fois plus vite pendant la dernière minute).
2. Les animaux foncent vers les structures adverses. Une tour cassée rapporte 1 couronne, la **structure principale**
   en rapporte 3 et termine le combat. À égalité, prolongations : la première couronne gagne.
3. **Siffler** rappelle tes animaux près de ton camp pour défendre. **Attaquer** : touche ensuite un endroit, une
   structure ou un animal, et tes animaux se mettent à le viser.
4. Les victoires classées rapportent des trophées et une **cage**. Une cage se range dans l'un des 4 emplacements de
   l'accueil, se débloque en un temps qui dépend de sa rareté (3 min à 24 h), puis s'ouvre. Les gemmes l'ouvrent tout
   de suite, les pattes font gagner 2 minutes chacune.
5. Les cages donnent des pièces et des cartes. La première carte d'un animal le débloque ; les suivantes servent à
   l'améliorer dans la Collection (cartes + pièces, comme dans Clash Royale). Toutes les cages peuvent contenir toutes
   les raretés : une cage plus précieuse rend seulement les cartes rares plus fréquentes.
6. La boutique propose chaque jour trois offres de cartes payées en pièces (une commune, une rare, une épique) et les
   sept cages, payées en gemmes.
7. Les trophées font monter d'arène (5 arènes, une tous les 300 trophées), chacune avec son décor et sa musique.

| Animal | Rareté | Aura | Rôle |
| --- | --- | --- | --- |
| Chaton | Commune | 2 | Soigneur à distance, touche aussi les volants |
| Singe | Commune | 3 | Deux singes rapides |
| Bulldog | Commune | 4 | Tank qui attire les coups |
| Cochon | Rare | 4 | Fonce sur les structures |
| Orang-outan | Rare | 5 | Lance des rochers (dégâts de zone) |
| Alligator | Épique | 5 | Broyeur, queue tournoyante |
| Aigle | Épique | 4 | Volant, bourrasque qui repousse |
| Gorille | Légendaire | 7 | Colosse, cri de guerre qui renforce les alliés |
| Rhinocéros | Légendaire | 6 | Charge, carapace |
| Éléphant | Ultime | 9 | Démolisseur de structures, trompe à eau |

Les bruitages ont été créés avec [Soundza](https://soundza.com) (sons générés par IA).

## Installer le jeu sur un téléphone

Ouvre le lien du jeu dans le navigateur du téléphone, puis « Ajouter à l'écran d'accueil ».
Le jeu se lance alors en plein écran et reste jouable sans connexion (contre des bots).

## Lancer le jeu sur un ordinateur

Il n'y a rien à compiler. Depuis ce dossier :

```
python3 -m http.server 8000
```

puis ouvre http://localhost:8000 dans le navigateur.

Adresses utiles pendant le développement :

- `?debug=1` montre les zones cliquables des menus ;
- `?test=1` saute l'écran du studio et les attentes ;
- `?slide=3000` ralentit dix fois le glissement entre les pages des menus, pour le vérifier image par image.

## Activer le jeu en ligne (amis, clans, classement, combats contre d'autres joueurs)

Sans réglage, le jeu fonctionne hors ligne : combats contre des bots et classement d'entraînement.
Le jeu en ligne utilise une base **Firebase Realtime Database** (gratuite) :

1. Sur https://console.firebase.google.com, crée un projet, puis « Realtime Database » → « Créer une base de données ».
2. Dans l'onglet « Règles » de la base, colle le contenu de [`online/regles-firebase.json`](online/regles-firebase.json) et publie.
3. Copie l'adresse de la base (elle ressemble à `https://xxxx-default-rtdb.europe-west1.firebasedatabase.app`)
   dans [`src/online/config.js`](src/online/config.js), champ `databaseURL`.

Ces règles sont volontairement ouvertes (pas de compte joueur, résultats calculés sur l'appareil) : c'est suffisant pour jouer
entre amis, mais il faudra les renforcer avant une sortie publique.

Les combats contre d'autres joueurs sont « différés » : tu affrontes le deck enregistré par l'adversaire, joué par
l'ordinateur, et il reçoit le résultat à sa prochaine connexion.

## Organisation du dépôt

| Dossier | Contenu |
| --- | --- |
| `index.html`, `styles/` | la page et sa mise en forme |
| `src/data/` | tous les chiffres du jeu : animaux (`animals.js`), cartes, raretés, cages et boutique (`cards.js`), récompenses et arènes (`economy.js`), bots |
| `src/game/` | le moteur de combat en temps réel (`rt.js`), l'adversaire joué par l'ordinateur (`ai.js`) et la progression du joueur |
| `src/render/` | le dessin du combat (arène, animaux, effets, barre du bas) |
| `src/ui/` | menus, boutique, collection, ouverture des cages (`chest.js`), fenêtres et déroulé d'un combat |
| `src/online/` | le jeu en ligne |
| `assets/` | images, sons et polices |
| `tests/` | tests du moteur de combat, des cages et de la sauvegarde (`npm test`) |

Pour changer l'équilibrage, tout est dans [`src/data/animals.js`](src/data/animals.js), [`src/data/cards.js`](src/data/cards.js) et [`src/data/economy.js`](src/data/economy.js).
