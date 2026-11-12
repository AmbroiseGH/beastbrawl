// Connexion en ligne du jeu (amis, clans, classement, combats contre d'autres joueurs).
// Le jeu utilise une base « Firebase Realtime Database ». Tant que databaseURL est vide, le jeu reste hors ligne
// (combats contre des bots, classement d'entraînement).
//   databaseURL : adresse de la base, par exemple https://beast-brawl-xxxx-default-rtdb.europe-west1.firebasedatabase.app
//   apiKey      : clé web du projet Firebase (facultative : si elle est remplie, chaque joueur est connecté anonymement
//                 et les règles de la base peuvent exiger un joueur connecté)
export const ONLINE = {
  databaseURL: '',
  apiKey: '',
};
