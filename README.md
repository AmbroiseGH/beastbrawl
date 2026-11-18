# Beast Brawl!

Jeu de combat d'animaux en 2D, au format portrait, jouable dans le navigateur et installable sur téléphone.
Un jeu Michigan.

**Jouer :** https://ambroisegh.github.io/beastbrawl/

## Le jeu

Des combats d'animaux en temps réel, à la manière de Clash Royale.

1. Chaque combat dure 3 minutes. Tu as une main de 4 cartes tirées de ton deck de 8. Glisse une carte sur ton côté
   de l'arène pour poser l'animal : chaque carte coûte de l'**Aura** (la partie commence avec 5, la jauge se recharge
   toute seule, deux fois plus vite pendant la dernière minute).
2. L'arène, toute en hauteur, tient entière dans l'écran du téléphone (deux doigts ou la molette pour zoomer, puis
   glisser ; la mini-carte apparaît quand on zoome). Les animaux posés dans ta **zone bleue** (en bas) foncent vers le
   **camp adverse**, tout en haut. **Détruis-le pour gagner tout de suite** ; sinon, le camp le moins abîmé gagne au
   bout des 3 minutes (à égalité : mort subite d'une minute, le premier camp touché perd). Le camp le plus abîmé reçoit
   un coup de pouce : son Aura se recharge plus vite, et sa catapulte tire et se répare plus vite.
   Si la partie dure (entre 1 min 15 et 1 min 45 de jeu), une **boîte dorée** tombe au hasard du côté du camp en
   retard. Le camp qui la casse libère un **singe doré** : il court très vite, saute par-dessus les rivières et lance
   des bananes dorées qui rendent beaucoup de vie à ses animaux, puis s'en va.
3. Chaque camp a sa **catapulte**, poussée par **Barnabé**, le singe du tutoriel. Au camp, elle bombarde les animaux qui approchent ;
   le bouton **Catapulte** (ou un toucher sur elle) l'envoie au centre, d'où elle lance un rocher sur le camp adverse
   (5 % de sa vie) toutes les 11 secondes. Cassée, Barnabé la répare sur place.
4. Les **nageurs** (poisson clown, poulpe, dauphin) se posent dans l'eau tout près de ton camp et suivent la rivière ;
   ils plongent sous les ponts et ne s'arrêtent jamais dessous. Ils frappent tout sauf les volants (tours, catapultes,
   animaux, et le camp adverse depuis l'eau qui l'entoure), et seuls les volants et les nageurs peuvent les toucher.
5. Les **boîtes** cassées donnent un bonus à ton camp (un singe ou un chaton en renfort, des fruits qui soignent, une
   rage qui augmente les dégâts, de l'Aura). Les deux **tours** latérales ont un singe en haut : casse la tour adverse
   et son singe lance ses pierres pour toi, et tu peux poser tes animaux à côté. L'adversaire peut la reprendre.
   Ordres : touche un de tes animaux puis sa cible (un animal, une boîte, une tour, la catapulte, le camp), ou glisse de
   l'animal jusqu'à la cible (au bord de l'écran, l'arène défile de plus en plus vite) ; **Attaquer** allume tout et
   donne l'ordre à toute la troupe ; **Siffler** les ramène se soigner à la tente (un second coup les relâche). Le petit
   dresseur de chaque camp s'anime à chaque ordre.
6. Les victoires classées rapportent des trophées et une **cage**. Une cage se range dans l'un des 4 emplacements de
   l'accueil, se débloque en un temps qui dépend de sa rareté (3 min à 24 h), puis s'ouvre. Les gemmes l'ouvrent tout
   de suite, les pattes font gagner 2 minutes chacune.
7. Les cages donnent des pièces et des cartes. La première carte d'un animal le débloque ; les suivantes servent à
   l'améliorer dans la Collection (cartes + pièces, comme dans Clash Royale). Toutes les cages peuvent contenir toutes
   les raretés : une cage plus précieuse rend seulement les cartes rares plus fréquentes.
8. La boutique propose chaque jour trois offres de cartes payées en pièces (une commune, une rare, une épique) et les
   sept cages, payées en gemmes.
9. Les trophées font monter d'arène (5 arènes, une tous les 300 trophées), chacune avec son ambiance et sa musique.
10. Les combats, les améliorations et les défis du jour rapportent de l'**expérience** (l'étoile violette) : des étoiles
   filent vers la jauge du haut, qui monte en tintant. Chaque niveau gagné rapporte des pièces et des gemmes.

Le jeu se lance tout seul sur le logo Michigan Studios : la lumière balaie le logo pile sur l'accord de guitare
western. Puis vient l'écran de chargement, où les animaux bougent doucement, avec son jingle (et le cri du gorille,
quand la barre arrive à 100 %). Si le navigateur interdit le son avant un premier toucher (iPhone, première visite),
tout se lance quand même, en silence, et le son arrive au premier toucher.

À la première visite, **Barnabé** (le singe qui pousse les catapultes) fait visiter les menus, guide un combat
d'entraînement contre un bot facile, puis offre un coffre en bois (des cartes communes et quelques rares). Pendant ses
explications, le combat se fige et la caméra zoome sur ce dont il parle ; quand il attend un geste, une petite bulle le
rappelle. Sa voix change avec son humeur (content, ravi, songeur, effrayé). Le tutoriel se refait depuis les paramètres.

| Animal | Rareté | Aura | Rôle |
| --- | --- | --- | --- |
| Chaton | Commune | 2 | Soigneur à distance, pose des boucliers sur ses alliés |
| Poisson clown | Commune | 3 | Deux nageurs : bulles, pluie de bulles qui ralentit |
| Singe | Commune | 3 | Deux singes rapides |
| Bulldog | Commune | 4 | Garde du corps qui attire les coups |
| Cochon | Rare | 4 | Rot toxique : nuage qui empoisonne |
| Poulpe | Rare | 4 | Nageur costaud : tentacules, tourbillon qui étourdit |
| Orang-outan | Rare | 5 | Tank : intouchable quand il se protège la tête, lance des cailloux qui repoussent |
| Alligator | Épique | 5 | Énormes dégâts, peu de points de vie |
| Aigle | Épique | 4 | Volant, bourrasques qui repoussent |
| Dauphin | Épique | 5 | Nageur à distance : boules d'eau, saut de la vague qui repousse |
| Gorille | Légendaire | 7 | Colosse : chaque cri augmente ses dégâts |
| Rhinocéros | Légendaire | 6 | Charge, carapace de métal de plus en plus solide |
| Éléphant | Ultime | 9 | Puise dans les rivières et arrose : l'ennemi est ralenti |

Les bruitages (l'eau, les nageurs, les catapultes, la voix de Barnabé et la boîte dorée compris) et la guitare du logo ont été créés avec [Soundza](https://soundza.com) (sons générés par IA).

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
| `src/game/` | le moteur de combat en temps réel (`rt.js`), les chemins par les ponts (`nav.js`), l'adversaire joué par l'ordinateur (`ai.js`) et la progression du joueur |
| `src/render/` | le dessin du combat (caméra, arène vivante `mapfx.js`, animaux, effets, barre du bas) ; la carte et sa grille de marche sont dans `src/data/map.js` et `assets/map/` |
| `src/ui/` | menus, boutique, collection, ouverture des cages (`chest.js`), fenêtres, déroulé d'un combat, tutoriel de Barnabé (`tuto.js`), logo et écran de chargement (`logo.js`, `loadart.js`) |
| `src/online/` | le jeu en ligne |
| `assets/` | images, sons et polices |
| `tests/` | tests du moteur de combat, des cages et de la sauvegarde (`npm test`) |

Pour changer l'équilibrage, tout est dans [`src/data/animals.js`](src/data/animals.js), [`src/data/cards.js`](src/data/cards.js) et [`src/data/economy.js`](src/data/economy.js).
