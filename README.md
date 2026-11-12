# Beast Brawl!

Jeu de combat d'animaux en 2D, au format portrait, jouable dans le navigateur et installable sur téléphone.
Un jeu Michigan.

**Jouer :** https://ambroisegh.github.io/beastbrawl/

## Le jeu

1. Avant chaque combat, tu places tes animaux sur les carrés bleus de ton côté de l'arène (5 slots d'équipe).
2. Tu appuies sur « Combattre ! » : les animaux se battent tout seuls jusqu'à ce qu'une équipe soit entièrement K.-O.
3. Tu gagnes des pièces, des pattes, des rubis, de l'expérience et des trophées, tu améliores tes animaux et tu montes d'arène.

Deux animaux sont jouables dans cette V1 :

| Animal | Rôle | Particularité |
| --- | --- | --- |
| Singe | Attaquant | Frappe très vite, sa queue touche tous les ennemis autour de lui, esquive parfois. Son 4ᵉ coup est un coup du poirier. |
| Bulldog | Tank | Beaucoup de points de vie, attire les coups des ennemis proches. Son 3ᵉ coup est une roulade qui étourdit. |

Les huit autres animaux de la boutique sont annoncés « Bientôt ».

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
- `?test=1` saute l'écran du studio et les attentes.

## Activer le jeu en ligne (amis, clans, classement, combats contre d'autres joueurs)

Sans réglage, le jeu fonctionne hors ligne : combats contre des bots et classement d'entraînement.
Le jeu en ligne utilise une base **Firebase Realtime Database** (gratuite) :

1. Sur https://console.firebase.google.com, crée un projet, puis « Realtime Database » → « Créer une base de données ».
2. Dans l'onglet « Règles » de la base, colle le contenu de [`online/regles-firebase.json`](online/regles-firebase.json) et publie.
3. Copie l'adresse de la base (elle ressemble à `https://xxxx-default-rtdb.europe-west1.firebasedatabase.app`)
   dans [`src/online/config.js`](src/online/config.js), champ `databaseURL`.

Les combats contre d'autres joueurs sont « différés » : tu affrontes l'équipe et le placement enregistrés par l'adversaire,
et il reçoit le résultat à sa prochaine connexion.

## Organisation du dépôt

| Dossier | Contenu |
| --- | --- |
| `index.html`, `styles/` | la page et sa mise en forme |
| `src/data/` | tous les chiffres du jeu : animaux, arène, récompenses, bots |
| `src/game/` | le moteur de combat (`sim.js`) et la progression du joueur |
| `src/render/` | le dessin du combat (animaux, effets, chiffres de dégâts) |
| `src/ui/` | menus, fenêtres, placement et déroulé d'un combat |
| `src/online/` | le jeu en ligne |
| `assets/` | images, sons et polices |
| `tests/` | tests du moteur de combat (`npm test`) |

Pour changer l'équilibrage, tout est dans [`src/data/animals.js`](src/data/animals.js) et [`src/data/economy.js`](src/data/economy.js).
