// Jeu en ligne : profil, amis, clans, discussion de clan, classement, adversaires réels et messages.
// Tout passe par l'interface REST de Firebase Realtime Database (aucune bibliothèque à charger).
// Les combats contre d'autres joueurs sont « différés » : on affronte l'équipe enregistrée de l'adversaire,
// le combat est simulé sur l'appareil, puis l'adversaire reçoit le résultat dans ses messages.
import { ONLINE } from './config.js';
import { S, changed } from '../core/save.js';
import { uid as newId } from '../core/utils.js';
import { ANIMALS } from '../data/animals.js';
import { validTeam } from '../data/bots.js';

const LS = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const cfg = { url: (new URLSearchParams(location.search).get('db') || LS('beastbrawl.db') || ONLINE.databaseURL || '').replace(/\/+$/, ''), key: ONLINE.apiKey || '' };
let token = '', tokenExp = 0, up = false, lastPush = 0, pushTimer = 0;
const NOW = { '.sv': 'timestamp' };

async function auth() {
  if (!cfg.key) return '';
  if (token && Date.now() < tokenExp - 60000) return token;
  const refresh = LS('beastbrawl.rt');
  let r;
  if (refresh) {
    r = await fetch('https://securetoken.googleapis.com/v1/token?key=' + cfg.key, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refresh) });
    if (r.ok) { const j = await r.json(); token = j.id_token; tokenExp = Date.now() + (+j.expires_in) * 1000; try { localStorage.setItem('beastbrawl.rt', j.refresh_token); } catch (e) { /* rien */ } return token; }
  }
  r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + cfg.key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  if (!r.ok) throw new Error('connexion refusée');
  const j = await r.json(); token = j.idToken; tokenExp = Date.now() + (+j.expiresIn) * 1000;
  try { localStorage.setItem('beastbrawl.rt', j.refreshToken); } catch (e) { /* rien */ }
  return token;
}
async function req(method, path, body, query = {}) {
  if (!cfg.url) throw new Error('hors ligne');
  const t = await auth(); if (t) query.auth = t;
  const qs = Object.keys(query).map((k) => k + '=' + encodeURIComponent(query[k])).join('&');
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(`${cfg.url}/${path}.json${qs ? '?' + qs : ''}`, { method, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) throw new Error('serveur ' + r.status);
    up = true; return await r.json();
  } catch (e) { if (e.name === 'AbortError' || e instanceof TypeError) up = false; throw e; } finally { clearTimeout(timer); }
}
const get = (p, q) => req('GET', p, undefined, q), put = (p, b) => req('PUT', p, b), patch = (p, b) => req('PATCH', p, b), post = (p, b) => req('POST', p, b), del = (p) => req('DELETE', p);
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);
const key = (name) => clean(name, 20).toLowerCase().replace(/[^a-z0-9àâçéèêëîïôûùüÿœ]/g, '_');
const myTeam = () => S.formation.filter((u) => ANIMALS[u.id]).map((u) => ({ id: u.id, col: u.col, row: u.row, level: (S.animals[u.id] || { level: 1 }).level }));
const me = () => ({ name: clean(S.name, 14) || 'Dresseur', avatar: S.avatar, level: S.level, trophies: S.trophies, clan: S.clan ? S.clan.id : null, clanName: S.clan ? S.clan.name : '', team: myTeam(), seen: NOW });
// Un joueur lu sur le serveur n'est jamais cru sur parole : on vérifie son équipe avant de la faire combattre
function safePlayer(id, p) {
  if (!p || typeof p !== 'object') return null;
  let team = Array.isArray(p.team) ? p.team.filter((u) => u && ANIMALS[u.id]).map((u) => ({ id: u.id, col: u.col | 0, row: u.row | 0, level: Math.max(1, Math.min(15, u.level | 0)) })) : [];
  if (!validTeam(team, (a) => ANIMALS[a].slots)) team = [];
  return { uid: id, name: clean(p.name, 14) || 'Dresseur', avatar: /^[a-z0-9]+$/.test(p.avatar || '') ? p.avatar : 'tiger', level: p.level | 0 || 1, trophies: Math.max(0, p.trophies | 0), clan: p.clan || null, clanName: clean(p.clanName, 20), units: team, seen: +p.seen || 0, online: Date.now() - (+p.seen || 0) < 150000 };
}

export const Net = {
  configured: () => !!cfg.url,
  online: () => !!cfg.url && up,
  // Au démarrage : on publie le profil et on revient régulièrement signaler sa présence
  async init() {
    if (!cfg.url) return false;
    try { await Net.pushProfile(true); setInterval(() => { if (!document.hidden) Net.pushProfile(true); }, 60000); return true; } catch (e) { console.warn('jeu en ligne indisponible :', e.message); return false; }
  },
  // Publie le profil (regroupé : au plus une fois toutes les 3 s)
  pushProfile(now) {
    if (!cfg.url) return Promise.resolve();
    const run = async () => {
      lastPush = Date.now();
      await patch('players/' + S.uid, me());
      if (S.clan) await patch(`clans/${S.clan.id}/members/${S.uid}`, { name: clean(S.name, 14), avatar: S.avatar, trophies: S.trophies, seen: NOW }).catch(() => {});
    };
    if (now) return run();
    clearTimeout(pushTimer); pushTimer = setTimeout(() => run().catch(() => {}), Math.max(200, 3000 - (Date.now() - lastPush)));
    return Promise.resolve();
  },
  async player(id) { return safePlayer(id, await get('players/' + id)); },
  // Classement : les n joueurs qui ont le plus de trophées
  async top(n = 50) {
    const d = await get('players', { orderBy: '"trophies"', limitToLast: n });
    return Object.keys(d || {}).map((k) => safePlayer(k, d[k])).filter(Boolean).sort((a, b) => b.trophies - a.trophies);
  },
  // Un adversaire réel proche en trophées (ou null s'il n'y en a pas)
  async findOpponent(trophies) {
    const d = await get('players', { orderBy: '"trophies"', startAt: Math.max(0, trophies - 250), endAt: trophies + 250, limitToFirst: 40 });
    const list = Object.keys(d || {}).filter((k) => k !== S.uid).map((k) => safePlayer(k, d[k])).filter((p) => p && p.units.length);
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
  },
  // Prévient l'adversaire du résultat (il le lira dans ses messages)
  report(oppUid, win, friendly) { return post('inbox/' + oppUid, { type: 'attack', from: S.uid, name: clean(S.name, 14), win: !!win, friendly: !!friendly, ts: NOW }).catch(() => {}); },

  // ----- amis -----
  async addFriend(code) {
    const id = clean(code, 20).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!id || id === S.uid) throw new Error('Ce code n\'est pas valable.');
    const p = await Net.player(id); if (!p) throw new Error('Aucun joueur avec ce code.');
    await put(`friends/${S.uid}/${id}`, true); await put(`friends/${id}/${S.uid}`, true);
    post('inbox/' + id, { type: 'friend', from: S.uid, name: clean(S.name, 14), ts: NOW }).catch(() => {});
    if (!S.friends.includes(id)) { S.friends.push(id); changed(); }
    return p;
  },
  async friends() {
    const d = await get('friends/' + S.uid); const ids = Object.keys(d || {});
    S.friends = ids; changed();
    const ps = await Promise.all(ids.map((id) => Net.player(id).catch(() => null)));
    return ps.filter(Boolean).sort((a, b) => (b.online - a.online) || (b.trophies - a.trophies));
  },
  async removeFriend(id) { await del(`friends/${S.uid}/${id}`); await del(`friends/${id}/${S.uid}`).catch(() => {}); S.friends = S.friends.filter((x) => x !== id); changed(); },

  // ----- clans -----
  async createClan(name, desc) {
    name = clean(name, 18); desc = clean(desc, 80);
    if (name.length < 3) throw new Error('Le nom doit faire au moins 3 caractères.');
    if (await get('clanNames/' + key(name))) throw new Error('Ce nom de clan est déjà pris.');
    const id = newId(8);
    await put('clans/' + id, { name, desc, leader: S.uid, created: NOW, members: { [S.uid]: { role: 'chef', name: clean(S.name, 14), avatar: S.avatar, trophies: S.trophies, joined: NOW, seen: NOW } } });
    await put('clanNames/' + key(name), id);
    S.clan = { id, name }; changed(); await Net.pushProfile(true);
    return id;
  },
  async clan(id) {
    const c = await get('clans/' + id); if (!c) return null;
    const members = Object.keys(c.members || {}).map((k) => ({ uid: k, name: clean(c.members[k].name, 14) || 'Dresseur', avatar: /^[a-z0-9]+$/.test(c.members[k].avatar || '') ? c.members[k].avatar : 'tiger', trophies: Math.max(0, c.members[k].trophies | 0), role: ['chef', 'aine', 'membre'].includes(c.members[k].role) ? c.members[k].role : 'membre', joined: +c.members[k].joined || 0, online: Date.now() - (+c.members[k].seen || 0) < 150000 }))
      .sort((a, b) => b.trophies - a.trophies);
    return { id, name: clean(c.name, 18), desc: clean(c.desc, 80), leader: c.leader, members, trophies: members.reduce((n, m) => n + m.trophies, 0) };
  },
  async searchClans(q) {
    const d = await get('clans'); q = clean(q, 18).toLowerCase();
    return Object.keys(d || {}).map((k) => { const c = d[k], ms = Object.values(c.members || {}); return { id: k, name: clean(c.name, 18), desc: clean(c.desc, 80), count: ms.length, trophies: ms.reduce((n, m) => n + Math.max(0, m.trophies | 0), 0) }; })
      .filter((c) => c.count > 0 && c.count < 50 && (!q || c.name.toLowerCase().includes(q))).sort((a, b) => b.trophies - a.trophies).slice(0, 30);
  },
  async joinClan(id) {
    const c = await Net.clan(id); if (!c) throw new Error('Ce clan n\'existe plus.');
    if (c.members.length >= 50) throw new Error('Ce clan est complet.');
    if (S.clan) await Net.leaveClan();
    await put(`clans/${id}/members/${S.uid}`, { role: 'membre', name: clean(S.name, 14), avatar: S.avatar, trophies: S.trophies, joined: NOW, seen: NOW });
    S.clan = { id, name: c.name }; changed(); await Net.pushProfile(true);
    post('clanChat/' + id, { sys: true, text: clean(S.name, 14) + ' a rejoint le clan.', ts: NOW }).catch(() => {});
    return c;
  },
  async leaveClan() {
    if (!S.clan) return;
    const id = S.clan.id, c = await Net.clan(id).catch(() => null);
    await del(`clans/${id}/members/${S.uid}`);
    if (c) {
      const rest = c.members.filter((m) => m.uid !== S.uid);
      if (!rest.length) { await del('clans/' + id); await del('clanNames/' + key(c.name)).catch(() => {}); await del('clanChat/' + id).catch(() => {}); }
      else if (c.leader === S.uid) {            // le chef s'en va : le plus ancien membre prend sa place
        const next = rest.slice().sort((a, b) => a.joined - b.joined)[0];
        await patch('clans/' + id, { leader: next.uid }); await patch(`clans/${id}/members/${next.uid}`, { role: 'chef' });
      }
    }
    S.clan = null; changed(); await Net.pushProfile(true);
  },
  async setRole(uid, role) { if (S.clan) await patch(`clans/${S.clan.id}/members/${uid}`, { role }); },
  async setDesc(desc) { if (S.clan) await patch('clans/' + S.clan.id, { desc: clean(desc, 80) }); },
  invite(toUid) { if (!S.clan) return Promise.resolve(); return post('inbox/' + toUid, { type: 'invite', from: S.uid, name: clean(S.name, 14), clan: S.clan.id, clanName: S.clan.name, ts: NOW }); },
  async chat(id) {
    const d = await get('clanChat/' + id, { orderBy: '"$key"', limitToLast: 40 });
    return Object.keys(d || {}).sort().map((k) => ({ key: k, from: d[k].from, name: clean(d[k].name, 14), text: clean(d[k].text, 140), sys: !!d[k].sys, ts: +d[k].ts || 0 }));
  },
  say(id, text) { return post('clanChat/' + id, { from: S.uid, name: clean(S.name, 14), text: clean(text, 140), ts: NOW }); },

  // ----- messages reçus (attaques subies, invitations, nouveaux amis) -----
  async inbox() {
    const d = await get('inbox/' + S.uid);
    return Object.keys(d || {}).sort().reverse().slice(0, 30).map((k) => ({ key: k, type: d[k].type, from: d[k].from, name: clean(d[k].name, 14), win: !!d[k].win, friendly: !!d[k].friendly, clan: d[k].clan, clanName: clean(d[k].clanName, 18), ts: +d[k].ts || 0 }));
  },
  clearInbox(k) { return del(`inbox/${S.uid}/${k}`).catch(() => {}); },
};
