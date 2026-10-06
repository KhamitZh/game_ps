import '../ui/styles.css';
import { DEFAULT_TIME_LIMIT_MIN, MAX_TIME_LIMIT_MIN, MIN_TIME_LIMIT_MIN } from '../../../shared/src/constants';
import type { PhaseInfo, PublicPlayer, ServerMsg } from '../../../shared/src/protocol';
import { rank, type RankedPlayer } from '../../../shared/src/ranking';
import { characterPreview } from '../art/characters';
import { wsUrl } from '../config';
import { onLangChange, t } from '../i18n';
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
  phase: null as PhaseInfo | null,
  offset: 0,
  roster: [] as PublicPlayer[],
  ranking: null as RankedPlayer[] | null,
  error: '',
  conn: null as Connection | null,
};

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

function renderLogin(): void {
  s.view = 'login';
  root.innerHTML = `
    <div class="host host-center">
      <form class="card panel stack" novalidate>
        <h1 class="logo">${t('app.title')}</h1>
        <p class="sub">${t('host.title')}</p>
        <label class="label" for="pw">${t('host.password')}</label>
        <input id="pw" class="input" type="password" autocomplete="current-password" />
        <label class="label" for="tl">${t('host.timeLimit')}</label>
        <input id="tl" class="input" type="number" min="${MIN_TIME_LIMIT_MIN}" max="${MAX_TIME_LIMIT_MIN}" value="${s.timeLimitMin}" />
        <p class="error">${s.error ? t(`error.${s.error}`) : ''}</p>
        <button class="btn btn-gold" type="submit">${t('host.create')}</button>
      </form>
    </div>`;
  const form = root.querySelector('form')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = root.querySelector<HTMLInputElement>('#pw')!.value;
    const tl = Number(root.querySelector<HTMLInputElement>('#tl')!.value) || DEFAULT_TIME_LIMIT_MIN;
    s.timeLimitMin = Math.min(MAX_TIME_LIMIT_MIN, Math.max(MIN_TIME_LIMIT_MIN, Math.round(tl)));
    form.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = true;
    try {
      const r = await createGame(pw, s.timeLimitMin);
      if (!r.ok) {
        s.error = r.code;
        return renderLogin();
      }
      s.pin = r.pin;
      s.hostToken = r.hostToken;
      s.timeLimitMin = r.timeLimitMin;
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
      s.roster = m.roster;
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
      renderRows();
      renderCount();
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
  s.error = '';
  overlay.hidden = true;
  renderLogin();
}

function renderDash(): void {
  s.view = 'dash';
  const ph = s.phase?.phase ?? 'LOBBY';
  const joinUrl = `${location.origin}/?pin=${s.pin}`;
  root.innerHTML = `
    <div class="host">
      <header class="host-head">
        <div>
          <div class="label">${t('host.pinLabel')}</div>
          <div class="pin">${s.pin}</div>
          <div class="label">${t('host.joinAt', { url: escapeHtml(joinUrl) })}</div>
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
    if (!p.online) tr.className = 'off';
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
  if (s.view === 'dash') renderDash();
  else if (s.view === 'login') renderLogin();
});
setInterval(renderTimer, 250);

const saved = loadSaved();
if (saved) {
  s.pin = saved.pin;
  s.hostToken = saved.hostToken;
  connect();
} else {
  renderLogin();
}
