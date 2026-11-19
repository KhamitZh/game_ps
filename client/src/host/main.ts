import '../ui/styles.css';
import { DEFAULT_TIME_LIMIT_MIN, MAX_TIME_LIMIT_MIN, MIN_TIME_LIMIT_MIN, TOTAL_ROOMS } from '../../../shared/src/constants';
import {
  ALL_SUBTOPICS, DEFAULT_DIFFICULTY, DEFAULT_LEVEL, DIFFICULTIES, DIFFICULTY_TITLES, LEVEL_IDS, LEVEL_TITLES, SUBTOPICS,
  hasSubtopics, subtopicIds, type Difficulty, type LevelId, type PoolSelection,
} from '../../../shared/src/levels';
import type { PhaseInfo, PublicPlayer, ServerMsg } from '../../../shared/src/protocol';
import { rank, type RankedPlayer } from '../../../shared/src/ranking';
import { characterPreview } from '../art/characters';
import type { LiveMapScene, View } from './LiveMap';
import { wsUrl } from '../config';
import { getLang, onLangChange, t } from '../i18n';
import { createGame } from '../net/api';
import { Connection, type ConnStatus } from '../net/connection';
import { byId, escapeHtml, fmtTime } from '../ui/dom';
import { podium } from '../ui/podium';
import { toast } from '../ui/toast';
import { mountTopBar } from '../ui/topbar';

const STORE_KEY = 'kh.host';
const root = byId('app');
const overlay = byId('overlay');

const s = {
  view: 'login' as 'login' | 'connecting' | 'dash',
  pin: '',
  hostToken: '',
  timeLimitMin: DEFAULT_TIME_LIMIT_MIN,
  /** Form choices; kept here so a re-render (language switch, error) shows the same choices. */
  level: DEFAULT_LEVEL as LevelId,
  subtopic: ALL_SUBTOPICS as string,
  difficulty: DEFAULT_DIFFICULTY as Difficulty,
  /** What the running game was created with (from hostWelcome). */
  game: { level: DEFAULT_LEVEL, subtopic: null, difficulty: null } as PoolSelection,
  poolSize: 0,
  phase: null as PhaseInfo | null,
  offset: 0,
  roster: [] as PublicPlayer[],
  ranking: null as RankedPlayer[] | null,
  error: '',
  conn: null as Connection | null,
  /** The player picked on the live map or in the table. */
  selected: null as string | null,
  mapView: 'all' as View,
};

// ---------- live map ----------
// One canvas for the whole session: re-rendering the dashboard moves it, never recreates it.
const liveEl = document.createElement('div');
liveEl.className = 'live';
liveEl.dataset.count = '0';
/**
 * While the map is not shown it waits here, off screen but with a real size: a WebGL canvas
 * whose parent collapses to 0×0 breaks its framebuffers.
 */
const liveParking = document.createElement('div');
liveParking.className = 'live-parking';
liveParking.setAttribute('aria-hidden', 'true');
document.body.append(liveParking);

function parkLive(): void {
  if (liveEl.parentElement === liveParking) return;
  liveParking.append(liveEl);
  live?.sleep();
}
let live: LiveMapScene | null = null;
let liveBoot: Promise<LiveMapScene> | null = null;

function ensureLive(): void {
  if (liveBoot) return;
  // Phaser is only needed once a game is open: load it then, not on the login form.
  liveBoot = import('./LiveMap').then((m) =>
    m.bootLiveMap(liveEl, selectPlayer, (n) => { liveEl.dataset.count = String(n); }),
  );
  liveBoot.then((scene) => {
    live = scene;
    if (liveEl.parentElement === liveParking) scene.sleep();
    scene.setRoster(s.roster);
    scene.setView(s.mapView);
    scene.select(s.selected);
  }).catch(() => toast(t('net.failed'), 'bad'));
}

function selectPlayer(id: string | null): void {
  s.selected = s.selected === id ? null : id;
  live?.select(s.selected);
  renderSelected();
  for (const tr of root.querySelectorAll<HTMLTableRowElement>('#rows tr')) tr.classList.toggle('sel', tr.dataset.id === s.selected);
}

function setView(view: View): void {
  s.mapView = view;
  live?.setView(view);
  for (const b of root.querySelectorAll<HTMLButtonElement>('.live-tabs button')) b.classList.toggle('on', b.dataset.view === view);
}

function renderSelected(): void {
  const box = root.querySelector<HTMLElement>('#selCard');
  if (!box) return;
  const ranked = rank(s.roster);
  const p = ranked.find((r) => r.id === s.selected);
  if (!p) {
    box.innerHTML = `<p class="hint">${t('host.live.hint')}</p>`;
    return;
  }
  const lobby = (s.phase?.phase ?? 'LOBBY') === 'LOBBY';
  box.innerHTML = `
    <div class="sel-card">
      <div class="sel-fig"></div>
      <div class="stack" style="gap:4px">
        <b class="sel-name">${escapeHtml(p.name)}</b>
        <span>${lobby ? '' : `${t('host.col.place')}: <b>${p.place}</b> · `}🔑 ${p.keys} · 🚪 ${p.rooms}/${TOTAL_ROOMS}</span>
        <span>${t(`floor.${p.floor}`)} · ${p.online ? t(`status.${p.status}`) : t('status.offline')}</span>
        <span>${t('host.col.time')}: ${fmtTime(p.lastKeyAt)}</span>
      </div>
      <button class="btn" type="button" id="selClose" aria-label="✕">✕</button>
    </div>`;
  box.querySelector('.sel-fig')!.append(characterPreview(p.character));
  box.querySelector('#selClose')!.addEventListener('click', () => selectPlayer(null));
}

function loadSaved(): { pin: string; hostToken: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    return v && typeof v.pin === 'string' && typeof v.hostToken === 'string' ? v : null;
  } catch {
    return null;
  }
}
function save(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ pin: s.pin, hostToken: s.hostToken }));
  } catch {
    // ignore
  }
}
function forget(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // ignore
  }
}

function levelTitle(id: LevelId): string {
  return LEVEL_TITLES[id]?.[getLang()] ?? id;
}

function subtopicTitle(level: LevelId, id: string): string {
  return id === ALL_SUBTOPICS ? t('host.allSubtopics') : SUBTOPICS[level]?.[id]?.[getLang()] ?? id;
}

function selectionTitle(sel: PoolSelection): string {
  const parts = [levelTitle(sel.level)];
  if (sel.subtopic) parts.push(subtopicTitle(sel.level, sel.subtopic));
  if (sel.difficulty) parts.push(DIFFICULTY_TITLES[sel.difficulty][getLang()]);
  return parts.join(' › ');
}

function subtopicOptions(level: LevelId): string {
  return [ALL_SUBTOPICS, ...subtopicIds(level)]
    .map((id) => `<option value="${id}"${id === s.subtopic ? ' selected' : ''}>${escapeHtml(subtopicTitle(level, id))}</option>`)
    .join('');
}

function renderLogin(): void {
  s.view = 'login';
  parkLive();
  root.innerHTML = `
    <div class="host host-center">
      <form class="card panel stack" novalidate>
        <h1 class="logo">${t('app.title')}</h1>
        <p class="sub">${t('host.title')}</p>
        <label class="label" for="pw">${t('host.password')}</label>
        <input id="pw" class="input" type="password" autocomplete="current-password" />
        <label class="label" for="tl">${t('host.timeLimit')}</label>
        <input id="tl" class="input" type="number" min="${MIN_TIME_LIMIT_MIN}" max="${MAX_TIME_LIMIT_MIN}" value="${s.timeLimitMin}" />
        <label class="label" for="lv">${t('host.level')}</label>
        <select id="lv" class="input">
          ${LEVEL_IDS.map((id, i) => `<option value="${id}"${id === s.level ? ' selected' : ''}>${i + 1}. ${escapeHtml(levelTitle(id))}</option>`).join('')}
        </select>
        <div id="subRow" class="stack"${hasSubtopics(s.level) ? '' : ' hidden'}>
          <label class="label" for="st">${t('host.subtopic')}</label>
          <select id="st" class="input">${subtopicOptions(s.level)}</select>
          <p class="hint" id="subHint"${s.subtopic === ALL_SUBTOPICS ? ' hidden' : ''}>${t('host.subtopicHint')}</p>
          <span class="label" id="diffLabel">${t('host.difficulty')}</span>
          <div class="seg" role="radiogroup" aria-labelledby="diffLabel">
            ${DIFFICULTIES.map((d) => `<label class="seg-opt"><input type="radio" name="diff" value="${d}"${d === s.difficulty ? ' checked' : ''} /><span>${escapeHtml(DIFFICULTY_TITLES[d][getLang()])}</span></label>`).join('')}
          </div>
        </div>
        <p class="error">${s.error ? t(`error.${s.error}`) : ''}</p>
        <button class="btn btn-gold" type="submit">${t('host.create')}</button>
      </form>
    </div>`;
  const form = root.querySelector('form')!;
  const st = root.querySelector<HTMLSelectElement>('#st')!;
  root.querySelector<HTMLSelectElement>('#lv')!.addEventListener('change', (e) => {
    s.level = (e.target as HTMLSelectElement).value as LevelId;
    s.subtopic = ALL_SUBTOPICS;
    st.innerHTML = subtopicOptions(s.level);
    root.querySelector<HTMLElement>('#subHint')!.hidden = true;
    root.querySelector<HTMLElement>('#subRow')!.hidden = !hasSubtopics(s.level);
  });
  st.addEventListener('change', () => {
    s.subtopic = st.value;
    root.querySelector<HTMLElement>('#subHint')!.hidden = s.subtopic === ALL_SUBTOPICS;
  });
  for (const r of root.querySelectorAll<HTMLInputElement>('input[name=diff]')) {
    r.addEventListener('change', () => {
      if (r.checked) s.difficulty = r.value as Difficulty;
    });
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = root.querySelector<HTMLInputElement>('#pw')!.value;
    const tl = Number(root.querySelector<HTMLInputElement>('#tl')!.value) || DEFAULT_TIME_LIMIT_MIN;
    s.timeLimitMin = Math.min(MAX_TIME_LIMIT_MIN, Math.max(MIN_TIME_LIMIT_MIN, Math.round(tl)));
    s.level = root.querySelector<HTMLSelectElement>('#lv')!.value as LevelId;
    const selection: PoolSelection = hasSubtopics(s.level)
      ? { level: s.level, subtopic: s.subtopic, difficulty: s.difficulty }
      : { level: s.level, subtopic: null, difficulty: null };
    form.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = true;
    try {
      const r = await createGame(pw, s.timeLimitMin, selection);
      if (!r.ok) {
        s.error = r.code;
        return renderLogin();
      }
      s.pin = r.pin;
      s.hostToken = r.hostToken;
      s.timeLimitMin = r.timeLimitMin;
      s.game = r.selection;
      s.error = '';
      save();
      connect();
    } catch {
      s.error = 'NETWORK';
      renderLogin();
    }
  });
  root.querySelector<HTMLInputElement>('#pw')!.focus();
}

function connect(): void {
  s.conn?.close();
  s.view = 'connecting';
  parkLive();
  root.innerHTML = `<div class="host host-center"><p>${t('net.connecting')}</p></div>`;
  s.conn = new Connection({
    url: wsUrl(s.pin),
    hello: () => ({ t: 'host', hostToken: s.hostToken }),
    onMessage,
    onStatus,
  });
  s.conn.open();
}

function onStatus(st: ConnStatus): void {
  if (st === 'open') overlay.hidden = true;
  else if (st === 'reconnecting' && s.view === 'dash') {
    overlay.hidden = false;
    overlay.innerHTML = `<div class="panel">${t('net.reconnecting')}</div>`;
  } else if (st === 'failed') {
    overlay.hidden = false;
    overlay.innerHTML = `<div class="panel stack"><p>${t('net.failed')}</p><button class="btn btn-gold" type="button">${t('net.reload')}</button></div>`;
    overlay.querySelector('button')!.addEventListener('click', () => location.reload());
  }
}

function onMessage(m: ServerMsg): void {
  switch (m.t) {
    case 'hostWelcome':
      s.timeLimitMin = m.timeLimitMin;
      s.game = { level: m.level, subtopic: m.subtopic, difficulty: m.difficulty };
      s.poolSize = m.poolSize ?? 0;
      s.roster = m.roster;
      live?.setRoster(m.roster);
      s.ranking = m.ranking;
      setPhase(m.phase);
      renderDash();
      return;
    case 'phase':
      setPhase(m.phase);
      renderDash();
      return;
    case 'roster':
      s.roster = m.players;
      live?.setRoster(m.players);
      renderRows();
      renderCount();
      renderSelected();
      return;
    case 'snapshot':
      live?.applySnapshot(m.players);
      return;
    case 'ended':
      s.ranking = m.ranking;
      renderDash();
      return;
    case 'error':
      if (m.code === 'BAD_HOST_TOKEN' || m.code === 'PIN_NOT_FOUND') {
        newGame();
        return;
      }
      toast(t(`error.${m.code}`), 'bad');
      return;
    default:
      return;
  }
}

function setPhase(p: PhaseInfo): void {
  s.phase = p;
  s.offset = p.serverNow - Date.now();
}

function newGame(): void {
  s.conn?.close();
  s.conn = null;
  forget();
  s.roster = [];
  s.ranking = null;
  s.phase = null;
  s.selected = null;
  live?.applySnapshot([]);
  live?.select(null);
  s.error = '';
  overlay.hidden = true;
  renderLogin();
}

function renderDash(): void {
  s.view = 'dash';
  parkLive();
  const ph = s.phase?.phase ?? 'LOBBY';
  const joinUrl = `${location.origin}/?pin=${s.pin}`;
  root.innerHTML = `
    <div class="host">
      <header class="host-head">
        <div>
          <div class="label">${t('host.pinLabel')}</div>
          <div class="pin">${s.pin}</div>
          <div class="label">${t('host.joinAt', { url: escapeHtml(joinUrl) })}</div>
          <div class="label">${t('host.level')}: <b>${escapeHtml(selectionTitle(s.game))}</b></div>
          ${s.poolSize > 0 && s.poolSize <= TOTAL_ROOMS ? `<div class="hint warn">${t('host.poolWarning', { n: s.poolSize })}</div>` : ''}
        </div>
        <div class="stack" style="justify-items:end">
          <div class="label"><span>${t(`host.phase.${ph}`)}</span> · <span id="count"></span></div>
          <div class="timer" id="timer"></div>
          <div class="row">
            ${ph === 'LOBBY' ? `<button class="btn btn-go" id="start" type="button">${t('host.start')}</button>` : ''}
            ${ph === 'PLAYING' || ph === 'COUNTDOWN' ? `<button class="btn btn-danger" id="stop" type="button">${t('host.stop')}</button>` : ''}
            ${ph === 'ENDED' ? `<button class="btn btn-gold" id="new" type="button">${t('host.newGame')}</button>` : ''}
          </div>
        </div>
      </header>
      <section id="podium"></section>
      ${ph !== 'ENDED' ? `
      <section class="live-wrap">
        <div class="row live-tabs">
          ${(['all', 'f1', 'f2', 'lobby'] as View[]).map((v) => `<button class="chip${v === s.mapView ? ' on' : ''}" type="button" data-view="${v}">${v === 'all' ? t('host.view.all') : t(`floor.${v}`)}</button>`).join('')}
        </div>
        <div id="liveSlot"></div>
        <div id="selCard"></div>
      </section>` : ''}
      <table class="table">
        <thead><tr>
          <th>${t('host.col.place')}</th><th></th><th>${t('host.col.name')}</th><th>🚪</th><th>🔑</th>
          <th>${t('host.col.floor')}</th><th>${t('host.col.status')}</th><th>${t('host.col.time')}</th>
        </tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>`;
  root.querySelector('#start')?.addEventListener('click', () => s.conn?.send({ t: 'start' }));
  root.querySelector('#stop')?.addEventListener('click', () => {
    if (confirm(t('host.confirmStop'))) s.conn?.send({ t: 'stop' });
  });
  root.querySelector('#new')?.addEventListener('click', newGame);
  if (ph === 'ENDED' && s.ranking) byId('podium').append(podium(s.ranking));
  const slot = root.querySelector('#liveSlot');
  if (slot) {
    slot.replaceWith(liveEl);
    live?.wake();
    ensureLive();
    for (const b of root.querySelectorAll<HTMLButtonElement>('.live-tabs button')) {
      b.addEventListener('click', () => setView(b.dataset.view as View));
    }
    renderSelected();
  }
  renderRows();
  renderCount();
  renderTimer();
}

function renderCount(): void {
  const c = root.querySelector('#count');
  if (c) c.textContent = `👥 ${s.roster.length}`;
  const start = root.querySelector<HTMLButtonElement>('#start');
  if (start) start.disabled = s.roster.length === 0;
}

function renderRows(): void {
  const body = root.querySelector('#rows');
  if (!body) return;
  const lobby = (s.phase?.phase ?? 'LOBBY') === 'LOBBY';
  body.innerHTML = '';
  for (const p of rank(s.roster)) {
    const tr = document.createElement('tr');
    tr.dataset.id = p.id;
    tr.className = `${p.online ? '' : 'off'}${p.id === s.selected ? ' sel' : ''}`.trim();
    tr.addEventListener('click', () => selectPlayer(p.id));
    tr.innerHTML = `
      <td>${lobby ? '' : p.place}</td><td class="c"></td><td>${escapeHtml(p.name)}</td>
      <td>${p.rooms}</td><td>${p.keys}</td><td>${t(`floor.${p.floor}`)}</td>
      <td>${p.online ? t(`status.${p.status}`) : t('status.offline')}</td><td>${fmtTime(p.lastKeyAt)}</td>`;
    tr.querySelector('.c')!.append(characterPreview(p.character));
    body.append(tr);
  }
}

function renderTimer(): void {
  const el = root.querySelector('#timer');
  if (!el) return;
  const p = s.phase;
  el.textContent =
    p?.phase === 'PLAYING' && p.endsAt ? `⏱ ${fmtTime(Math.max(0, Math.ceil((p.endsAt - (Date.now() + s.offset)) / 1000)))}` : '';
}

mountTopBar(byId('topbar'), false);
onLangChange(() => {
  live?.refreshLang();
  if (s.view === 'dash') renderDash();
  else if (s.view === 'login') renderLogin();
});
setInterval(renderTimer, 250);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') s.conn?.wake();
});
window.addEventListener('online', () => s.conn?.wake());

const saved = loadSaved();
if (saved) {
  s.pin = saved.pin;
  s.hostToken = saved.hostToken;
  connect();
} else {
  renderLogin();
}
