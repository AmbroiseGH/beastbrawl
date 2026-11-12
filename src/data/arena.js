// Géométrie du terrain, en cases. Chaque camp a une grille de placement de COLS × ROWS carrés,
// séparée de l'autre par un couloir vide de GAP cases. Le camp 0 est en bas, le camp 1 en haut.
export const COLS = 5;
export const ROWS = 3;
export const GAP = 1;
export const FW = COLS;               // largeur du terrain
export const FH = ROWS * 2 + GAP;     // hauteur du terrain

// Centre d'un carré de placement, pour un camp donné.
// col : 0 (gauche du joueur) à COLS-1 ; row : 0 (première ligne, près de l'ennemi) à ROWS-1 (fond).
// Le camp 1 est le camp 0 tourné de 180° : chaque joueur place ses bêtes « vues de chez lui ».
export function cellCenter(side, col, row) {
  const x = col + 0.5;
  const y = FH / 2 + GAP / 2 + row + 0.5;
  return side === 0 ? { x, y } : { x: FW - x, y: FH - y };
}

// Où le terrain se pose sur l'image de l'arène (pixels de la scène 941 × 1672, image de l'arène en haut)
export const CELL_PX = 138;
export const FIELD_X = 125;           // bord gauche de la grille
export const FIELD_Y = 222;           // bord haut de la grille
export const toPx = (x, y) => ({ x: FIELD_X + x * CELL_PX, y: FIELD_Y + y * CELL_PX });
export const fromPx = (px, py) => ({ x: (px - FIELD_X) / CELL_PX, y: (py - FIELD_Y) / CELL_PX });
