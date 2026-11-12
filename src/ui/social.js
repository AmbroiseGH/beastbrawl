// Pages Clan et Classé, amis et messages. Tout ce qui est « en ligne » passe par Net ; sans connexion,
// le classement montre des bots d'entraînement et le clan explique comment activer le jeu en ligne.
import { h, fmt } from '../core/utils.js';
import { S, changed } from '../core/save.js';
import { sfx } from '../core/audio.js';
import { arenaOf } from '../data/economy.js';
import { botLeaderboard } from '../data/bots.js';
import { register, render, current } from './menu.js';
import { handlers } from './pages.js';
import { modal, p, toast, ask, prompt } from './ui.js';
import { Net } from '../online/net.js';
import { startFight } from './battle.js';

const hit = (x, y, w, hgt, onclick, label) => h('button', { class: 'hit', 'aria-label': label, style: { left: x + 'px', top: y + 'px', width: w + 'px', height: hgt + 'px' }, onclick: () => { sfx.click(); onclick(); } });
const ctr = (x, y, cls, text) => h('div', { class: 'ctr t ' + cls, style: { left: x + 'px', top: y + 'px' } }, text);
const ROLE = { chef: 'Chef', aine: 'Aîné', membre: 'Membre' };
const fail = (e) => { sfx.error(); toast(e && e.message && !/serveur|fetch|abort|hors ligne/i.test(e.message) ? e.message : 'Connexion impossible. Réessaie dans un instant.'); };
const again = (t) => { if (current() === t) render(); };

// Une ligne de joueur (classement, membres, amis)
function row(pl, rank, opts = {}) {
  const rk = rank === 1 ? h('div', { class: 'rk c1 t sm' }, h('span', null, '1')) : rank === 2 ? h('div', { class: 'rk c2 t sm' }, h('span', null, '2')) : rank === 3 ? h('div', { class: 'rk c3 t sm' }, h('span', null, '3')) : rank ? h('div', { class: 'rk cn t sm' }, rank) : null;
  const sub = opts.role ? h('div', { class: 'chip t xs ' + opts.role }, ROLE[opts.role]) : h('div', { class: 'sub t xs cream' }, pl.clanName ? h('i', { class: 'ico', style: { backgroundImage: "url('assets/ui/ic_shield_red.webp')" } }) : null, pl.clanName || (opts.sub || ''));
  return h(opts.onclick ? 'button' : 'div', { class: 'lrow' + (rank === 1 ? ' gold' : '') + (opts.me ? ' me' : '') + (opts.onclick ? ' tap' : ''), style: { width: '100%' }, onclick: opts.onclick ? () => { sfx.click(); opts.onclick(); } : null },
    rk, h('div', { class: 'av', style: { backgroundImage: `url('assets/ui/av_${pl.avatar || 'tiger'}.webp')`, outline: pl.online ? '4px solid #5cff5c' : 'none' } }),
    h('div', { class: 'who' }, h('div', { class: 'nm t sm' }, pl.name), sub),
    opts.right || h('div', { class: 'tro t sm' }, h('i'), fmt(pl.trophies)));
}

// ================= Classé =================
let board = null, boardAt = 0;
register('ranked', (pg) => {
  const arena = arenaOf(S.trophies);
  pg.append(h('div', { class: 'rk-name t' }, S.name || 'Dresseur'), h('div', { class: 'rk-clan t sm' }, h('i'), S.clan ? S.clan.name : 'Sans clan'),
    ctr(795, 447, 'rk-tro', fmt(S.trophies)), ctr(472, 677, 'rk-arena', 'Arène ' + arena),
    hit(845, 646, 76, 76, () => handlers.road(), 'Arènes'), hit(62, 372, 150, 146, () => handlers.profile(), 'Profil'),
    h('button', { class: 'hit', 'aria-label': 'Combattre', style: { left: '165px', top: '1312px', width: '612px', height: '172px', borderRadius: '60px' }, onclick: () => handlers.fight() }));
  const list = h('div', { class: 'list', style: { top: '816px', height: '466px' } });
  pg.append(list);
  const mine = { uid: S.uid, name: S.name || 'Dresseur', avatar: S.avatar, trophies: S.trophies, clanName: S.clan ? S.clan.name : '' };
  const draw = (players, offline) => {
    const all = players.filter((x) => x.uid !== S.uid).concat([mine]).sort((a, b) => b.trophies - a.trophies);
    all.forEach((pl, i) => list.append(row(pl, i + 1, { me: pl === mine })));
    const meRow = list.querySelector('.me'); if (meRow && all.indexOf(mine) > 4) setTimeout(() => { list.scrollTop = meRow.offsetTop - 190; }, 30);
    if (offline) pg.append(h('div', { class: 'offline t xs', style: { top: '1286px' } }, 'Classement d\'entraînement (jeu hors ligne)'));
  };
  if (!Net.configured()) { draw(botLeaderboard(), true); return; }
  if (board) draw(board, false); else list.append(p('Chargement du classement…', 'small'));
  if (!board || Date.now() - boardAt > 20000) {
    boardAt = Date.now();
    Net.top(50).then((d) => { board = d; again('ranked'); }).catch(() => { if (!board) { list.textContent = ''; draw(botLeaderboard(), true); } });
  }
});

// ================= Clan =================
let sub = 'mine', clan = null, clanAt = 0, found = null, invites = null, query = '';
function tabs(pg) {
  if (sub !== 'mine') pg.append(h('div', { class: 'cl-tab', style: { left: '58px', top: '352px', width: '288px', height: '82px', backgroundImage: "url('assets/ui/tab1_off.webp')" } }));
  if (sub === 'search') pg.append(h('div', { class: 'cl-tab', style: { left: '350px', top: '364px', width: '270px', height: '70px', backgroundImage: "url('assets/ui/tab2_on.webp')" } }));
  if (sub === 'invites') pg.append(h('div', { class: 'cl-tab', style: { left: '626px', top: '364px', width: '224px', height: '70px', backgroundImage: "url('assets/ui/tab3_on.webp')" } }));
  pg.append(hit(60, 356, 284, 78, () => { sub = 'mine'; render(); }, 'Mon clan'), hit(352, 366, 266, 68, () => { sub = 'search'; found = null; render(); }, 'Rechercher'), hit(628, 366, 266, 68, () => { sub = 'invites'; invites = null; render(); }, 'Invitations'));
}
const needClan = () => toast('Rejoins ou crée d\'abord un clan.');
register('clan', (pg) => {
  // boutons du bas de la maquette
  const bottom = () => pg.append(hit(50, 1306, 240, 116, () => (S.clan ? chatPopup() : needClan()), 'Chat'), hit(306, 1304, 322, 120, () => (S.clan ? clanFight() : needClan()), 'Combat de clan'), hit(646, 1306, 248, 116, () => (S.clan ? invitePopup() : needClan()), 'Inviter'));
  if (!Net.configured()) {
    tabs(pg); bottom();
    pg.append(h('div', { class: 'cl-cover' }, h('div', { class: 't', style: { fontSize: '50px', marginTop: '30px' } }, 'Clans en ligne'),
      h('p', { html: 'Les clans, les amis et les combats contre d\'autres joueurs s\'activent dès que le jeu est relié à son serveur en ligne.' }),
      h('p', { class: 'small', style: { color: '#e7dccb', fontSize: '27px' }, html: 'En attendant, entraîne-toi contre les bots : tes trophées, tes animaux et tes récompenses sont bien enregistrés.' }),
      h('button', { class: 'btn purple t sm', style: { marginTop: '20px' }, onclick: () => { sfx.click(); startFight({ mode: 'friendly' }); } }, 'Combat d\'entraînement')));
    return;
  }
  tabs(pg); bottom();
  if (sub === 'search') return searchTab(pg);
  if (sub === 'invites') return invitesTab(pg);
  if (!S.clan) {
    pg.append(h('div', { class: 'cl-cover' }, h('div', { class: 't', style: { fontSize: '50px', marginTop: '40px' } }, 'Tu n\'as pas de clan'),
      h('p', { html: 'Crée ton clan et invite tes amis, ou rejoins un clan existant pour discuter et vous affronter.' }),
      h('button', { class: 'btn green big t', style: { marginTop: '30px' }, onclick: () => { sfx.click(); createClan(); } }, 'Créer un clan'),
      h('button', { class: 'btn blue t sm', onclick: () => { sfx.click(); sub = 'search'; found = null; render(); } }, 'Rechercher un clan')));
    return;
  }
  // mon clan
  const c = clan && clan.id === S.clan.id ? clan : null;
  pg.append(h('div', { class: 'cl-name t' }, c ? c.name : S.clan.name), h('div', { class: 'cl-desc t xs' }, c ? (c.desc || 'Bienvenue dans le clan !') : ''),
    ctr(414, 646, 'cl-val sm', c ? fmt(c.trophies) : '…'), ctr(656, 646, 'cl-val sm', c ? c.members.length + '/50' : '…'), ctr(482, 742, 'cl-members sm', 'Membres (' + (c ? c.members.length : '…') + '/50)'),
    hit(814, 461, 84, 82, () => clanSettings(), 'Réglages du clan'));
  const list = h('div', { class: 'list', style: { top: '792px', height: '494px' } }); pg.append(list);
  if (c) c.members.forEach((m, i) => list.append(row(m, i + 1, { role: m.role, me: m.uid === S.uid, onclick: m.uid === S.uid ? null : () => memberPopup(m, c) })));
  else list.append(p('Chargement du clan…', 'small'));
  if (!c || Date.now() - clanAt > 15000) {
    clanAt = Date.now();
    Net.clan(S.clan.id).then((d) => { if (!d || !d.members.some((m) => m.uid === S.uid)) { S.clan = null; clan = null; changed(); return; } clan = d; again('clan'); }).catch(() => {});
  }
});
function searchTab(pg) {
  const input = h('input', { class: 'field', placeholder: 'Nom du clan', maxlength: 18, value: query, style: { height: '80px', fontSize: '34px' } });
  const list = h('div', { class: 'list' });
  const run = () => { query = input.value; found = null; list.textContent = ''; list.append(p('Recherche…', 'small')); Net.searchClans(query).then((d) => { found = d; again('clan'); }).catch(fail); };
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') run(); });
  pg.append(h('div', { class: 'cl-cover', style: { alignItems: 'stretch' } }, h('div', { style: { display: 'flex', gap: '14px' } }, input, h('button', { class: 'btn blue small t sm', onclick: () => { sfx.click(); run(); } }, 'Chercher')), list));
  if (found === null) { Net.searchClans(query).then((d) => { found = d; again('clan'); }).catch(fail); list.append(p('Recherche…', 'small')); return; }
  if (!found.length) list.append(p('Aucun clan trouvé. Crée le tien !', 'small'));
  found.forEach((c) => list.append(h('button', { class: 'lrow tap', style: { width: '100%' }, onclick: async () => { sfx.click(); if (S.clan && S.clan.id === c.id) return toast('Tu es déjà dans ce clan.'); if (await ask(c.name, (c.desc || 'Rejoindre ce clan ?') + (S.clan ? '<br><br>Tu quitteras ton clan actuel.' : ''), 'Rejoindre', 'Annuler')) Net.joinClan(c.id).then((d) => { clan = d; clanAt = 0; sub = 'mine'; toast('Bienvenue dans ' + c.name + ' !'); render(); }).catch(fail); } },
    h('div', { class: 'av', style: { backgroundImage: "url('assets/ui/ic_shield_red.webp')", backgroundSize: 'contain', border: 'none', background: "center/contain no-repeat url('assets/ui/ic_shield_red.webp')" } }),
    h('div', { class: 'who' }, h('div', { class: 'nm t sm' }, c.name), h('div', { class: 'sub t xs cream' }, c.count + '/50 membres')), h('div', { class: 'tro t sm' }, h('i'), fmt(c.trophies)))));
}
function invitesTab(pg) {
  const list = h('div', { class: 'list' });
  pg.append(h('div', { class: 'cl-cover', style: { alignItems: 'stretch' } }, h('p', { html: 'Invitations reçues' }), list));
  if (invites === null) { list.append(p('Chargement…', 'small')); Net.inbox().then((d) => { invites = d.filter((m) => m.type === 'invite'); again('clan'); }).catch(fail); return; }
  if (!invites.length) list.append(p('Aucune invitation pour le moment.', 'small'));
  invites.forEach((m) => list.append(h('div', { class: 'lrow', style: { width: '100%' } }, h('div', { class: 'who' }, h('div', { class: 'nm t sm' }, m.clanName), h('div', { class: 'sub t xs cream' }, 'Invité par ' + m.name)),
    h('button', { class: 'btn green small t sm act', onclick: () => { sfx.click(); Net.joinClan(m.clan).then((d) => { Net.clearInbox(m.key); clan = d; clanAt = 0; sub = 'mine'; invites = null; toast('Bienvenue dans ' + m.clanName + ' !'); render(); }).catch(fail); } }, 'Rejoindre'),
    h('button', { class: 'btn red small t sm act', style: { minWidth: '90px' }, onclick: () => { sfx.back(); Net.clearInbox(m.key); invites = invites.filter((x) => x !== m); render(); } }, '✕'))));
}
async function createClan() {
  const name = await prompt('Créer un clan', 'Nom du clan (3 à 18 caractères)', '', 18, 'Créer');
  if (!name) return;
  const desc = await prompt('Devise du clan', 'Une phrase pour présenter ton clan', 'Combattez, améliorez vos bêtes et grimpez !', 80, 'Valider');
  Net.createClan(name, desc || '').then(() => { clan = null; clanAt = 0; sub = 'mine'; sfx.upgrade(); toast('Clan « ' + name + ' » créé !'); render(); }).catch(fail);
}
function clanSettings() {
  const chef = clan && clan.leader === S.uid;
  const m = modal({ title: S.clan.name, body: [p(chef ? 'Tu es le chef de ce clan.' : 'Tu es membre de ce clan.', 'small')], buttons: [
    chef ? { label: 'Changer la devise', color: 'blue', small: true, onclick: async () => { const d = await prompt('Devise du clan', '', clan ? clan.desc : '', 80); if (d) Net.setDesc(d).then(() => { clanAt = 0; render(); }).catch(fail); } } : null,
    { label: 'Quitter le clan', color: 'red', small: true, onclick: async () => { if (await ask('Quitter le clan ?', chef ? 'Le plus ancien membre deviendra chef. Si tu es seul, le clan sera supprimé.' : 'Tu pourras en rejoindre un autre.', 'Quitter', 'Rester')) Net.leaveClan().then(() => { clan = null; render(); }).catch(fail); } }].filter(Boolean) });
}
function memberPopup(m, c) {
  const chef = c.leader === S.uid;
  modal({ title: m.name, color: 'purple', body: [p(`${ROLE[m.role]} · ${fmt(m.trophies)}<i class="ico trophy"></i>${m.online ? ' · <span style="color:var(--good)">en ligne</span>' : ''}`)], buttons: [
    { label: 'Défier', color: 'purple', onclick: () => challenge(m.uid) },
    chef && m.role !== 'chef' ? { label: m.role === 'aine' ? 'Rétrograder' : 'Nommer aîné', color: 'blue', small: true, onclick: () => Net.setRole(m.uid, m.role === 'aine' ? 'membre' : 'aine').then(() => { clanAt = 0; render(); }).catch(fail) } : null].filter(Boolean) });
}
function clanFight() {
  if (!clan) return toast('Chargement du clan…');
  const others = clan.members.filter((m) => m.uid !== S.uid);
  if (!others.length) return toast('Invite d\'abord des amis dans ton clan !');
  const m = modal({ title: 'Combat de clan', color: 'purple', body: [p('Choisis un membre à défier (combat amical, sans trophées).', 'small'), ...others.map((o, i) => row(o, 0, { role: o.role, onclick: () => { m.close(); challenge(o.uid); } }))] });
}
// Défi amical : on affronte l'équipe enregistrée de l'autre joueur
export function challenge(uid) {
  Net.player(uid).then((pl) => {
    if (!pl || !pl.units.length) return toast('Ce joueur n\'a pas encore d\'équipe enregistrée.');
    startFight({ mode: 'friendly', opp: pl });
  }).catch(fail);
}
function chatPopup() {
  const msgs = h('div', { class: 'msgs' }), input = h('input', { class: 'field', maxlength: 140, placeholder: 'Ton message…' });
  let stop = false, lastKey = '';
  const load = () => Net.chat(S.clan.id).then((list) => {
    if (stop) return;
    const k = list.length ? list[list.length - 1].key : '';
    if (k === lastKey && msgs.childElementCount) return; lastKey = k;
    msgs.textContent = '';
    if (!list.length) msgs.append(p('Dis bonjour à ton clan !', 'small'));
    list.forEach((m) => msgs.append(h('div', { class: 'm t xs' + (m.from === S.uid ? ' me' : ''), style: m.sys ? { alignSelf: 'center', background: 'none', border: 'none', color: '#ffd9a0' } : null }, m.sys ? null : h('b', null, m.name), m.text)));
    msgs.scrollTop = msgs.scrollHeight;
  }).catch(() => {});
  const send = () => { const v = input.value.trim(); if (!v) return; input.value = ''; sfx.click(); Net.say(S.clan.id, v).then(load).catch(fail); };
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') send(); });
  modal({ title: 'Chat du clan', body: [h('div', { class: 'chat' }, msgs, h('div', { class: 'send' }, input, h('button', { class: 'btn blue small t sm', onclick: send }, 'Envoyer')))], onClose: () => { stop = true; clearInterval(timer); } });
  load(); const timer = setInterval(load, 4000);
}
function invitePopup() {
  const body = [p(`Envoie une invitation à un ami, ou donne-lui le nom de ton clan : <span style="color:var(--gold)">${S.clan.name}</span>`, 'small')];
  const m = modal({ title: 'Inviter', body });
  Net.friends().then((fr) => {
    if (!fr.length) m.body.append(p('Ajoute d\'abord des amis avec le bouton Amis de l\'accueil.', 'small'));
    fr.forEach((f) => m.body.append(row(f, 0, { right: h('button', { class: 'btn green small t sm act', onclick: (e) => { sfx.click(); e.currentTarget.classList.add('off'); Net.invite(f.uid).then(() => toast('Invitation envoyée à ' + f.name + ' !')).catch(fail); } }, 'Inviter') })));
  }).catch(fail);
}

// ================= Amis =================
export function friendsPopup() {
  if (!Net.configured()) {
    modal({ title: 'Amis', color: 'purple', body: [p('Les amis s\'activent dès que le jeu est relié à son serveur en ligne.'), p(`Ton code ami est déjà prêt : <span style="color:var(--gold)">${S.uid.toUpperCase()}</span>`, 'small')], buttons: [{ label: 'Combat d\'entraînement', color: 'purple', onclick: () => startFight({ mode: 'friendly' }) }] });
    return;
  }
  const listEl = h('div');
  const m = modal({ title: 'Amis', color: 'purple', body: [p(`Ton code ami : <span style="color:var(--gold);-webkit-user-select:text;user-select:text">${S.uid.toUpperCase()}</span>`, 'small'), listEl], buttons: [{ label: 'Ajouter un ami', color: 'green', keep: true, onclick: async () => {
    const code = await prompt('Ajouter un ami', 'Tape le code ami de ton ami', '', 20, 'Ajouter');
    if (code) Net.addFriend(code).then((pl) => { sfx.reward(); toast(pl.name + ' est maintenant ton ami !'); load(); }).catch(fail);
  } }] });
  const load = () => { listEl.textContent = ''; listEl.append(p('Chargement…', 'small')); Net.friends().then((fr) => {
    listEl.textContent = '';
    if (!fr.length) listEl.append(p('Aucun ami pour le moment. Échange ton code avec tes amis !', 'small'));
    fr.forEach((f) => listEl.append(row(f, 0, { sub: f.online ? 'En ligne' : 'Hors ligne', right: h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
      h('div', { class: 'tro t sm', style: { minWidth: '130px' } }, h('i'), fmt(f.trophies)),
      h('button', { class: 'btn purple small t sm', style: { minWidth: '130px', padding: '0 14px 8px' }, onclick: () => { sfx.click(); m.close(); challenge(f.uid); } }, 'Défier'),
      h('button', { class: 'btn red small t sm', style: { minWidth: '70px', padding: '0 10px 8px' }, onclick: async () => { sfx.click(); if (await ask('Retirer cet ami ?', f.name + ' ne sera plus dans ta liste.', 'Retirer', 'Garder')) Net.removeFriend(f.uid).then(load).catch(fail); } }, '✕')) })));
  }).catch((e) => { listEl.textContent = ''; listEl.append(p('Connexion impossible pour le moment.', 'small')); }); };
  load();
}

// Messages reçus (attaques, nouveaux amis) : affichés une fois puis effacés
export async function readInbox() {
  if (!Net.configured()) return;
  try {
    const list = (await Net.inbox()).filter((m) => m.type !== 'invite');
    if (!list.length) return;
    const lines = list.slice(0, 8).map((m) => m.type === 'friend' ? `<span style="color:var(--gold)">${m.name}</span> t'a ajouté en ami.` : `<span style="color:var(--gold)">${m.name}</span> t'a ${m.friendly ? 'défié' : 'attaqué'} : ${m.win ? '<span style="color:var(--bad)">ton équipe a perdu</span>' : '<span style="color:var(--good)">ton équipe a tenu bon !</span>'}`);
    modal({ title: 'Messages', body: lines.map((l) => p(l, 'small')), buttons: [{ label: 'OK', color: 'blue' }] });
    list.forEach((m) => Net.clearInbox(m.key));
  } catch (e) { /* hors ligne : rien à lire */ }
}
