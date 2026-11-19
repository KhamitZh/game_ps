import './ui/styles.css';
import type { RankedPlayer } from '../../shared/src/ranking';
import type { ClientMsg, ErrorCode, Phase, PhaseInfo, PublicPlayer, QuestionView, ServerMsg, YouState } from '../../shared/src/protocol';
import type { RoomId } from '../../shared/src/map';
import { sfx, unlockAudio } from './audio/sfx';
import { wsUrl } from './config';
import { errorAction, type Stage } from './errorRouting';
import type { WorldCallbacks, WorldScene } from './game/WorldScene';
import { getLang, onLangChange, t } from './i18n';
import { getGameInfo } from './net/api';
import { Connection, type ConnStatus } from './net/connection';
import { runCountdown } from './ui/countdown';
import { byId } from './ui/dom';
import { Hud } from './ui/hud';
import { renderResults } from './ui/podium';
import { QuestionModal } from './ui/question';
import { renderCharacters, renderHome, renderName, renderResume } from './ui/screens';
import { SpectateBar } from './ui/spectate';
import { toast } from './ui/toast';
import { mountTopBar } from './ui/topbar';
import { TouchControls, isTouchDevice } from './ui/touch';

type Prompt = 'interact' | 'stairsLocked' | null;

const SESSION_KEY = 'kh.session';
/** A saved seat outlives a closed tab or a killed phone browser, but not the game's storage. */
const SESSION_TTL_MS = 3 * 60 * 60 * 1000;
/** A first join that cannot reach the server gives up quickly instead of retrying for minutes. */
const JOIN_MAX_RETRIES = 3;
const RESULT_SHOW_MS = 1400;
const PENDING_TIMEOUT_MS = 3000;

const ui = {
  screen: byId('screen'),
  hud: new Hud(byId('hud')),
  modal: new QuestionModal(byId('modal')),
  countdown: byId('countdown'),
  overlay: byId('overlay'),
  lobbybar: byId('lobbybar'),
  touchRoot: byId('touch'),
};

const app = {
  stage: 'home' as Stage,
  error: '',
  pin: new URLSearchParams(location.search).get('pin')?.replace(/\D/g, '').slice(0, 6) ?? '',
  name: '',
  character: -1,
  conn: null as Connection | null,
  hello: null as ClientMsg | null,
  worldBoot: null as Promise<WorldScene> | null,
  world: null as WorldScene | null,
  you: null as YouState | null,
  phase: null as PhaseInfo | null,
  roster: [] as PublicPlayer[],
  ranking: null as RankedPlayer[] | null,
  offset: 0,
  freeze: new Set<string>(),
  stopCountdown: null as (() => void) | null,
  touch: null as TouchControls | null,
  prompt: null as Prompt,
  pendingTimer: 0,
  joinRetries: 0,
  /** A seat found in shared storage, waiting for the student to confirm it is theirs. */
  resumeSeat: null as Seat | null,
};

const spectateBar = new SpectateBar(byId('spectate'), (id) => {
  app.conn?.send({ t: 'spectate', targetId: id });
  app.world?.spectate(id);
});

// ---------- session ----------

/**
 * The tab's own seat lives in sessionStorage (survives a reload). A copy in localStorage survives a
 * closed tab or a killed phone browser. That copy is shared by every tab and by whoever sits at the
 * computer next, so it is never resumed silently: the student first confirms it is their name, and
 * the server still refuses it ("soft") while the seat is open in another tab.
 */
interface Seat { pin: string; token: string; name: string }
function readSeat(store: Storage): Seat | null {
  try {
    const s = JSON.parse(store.getItem(SESSION_KEY) ?? 'null');
    if (!s || typeof s.pin !== 'string' || typeof s.token !== 'string' || typeof s.savedAt !== 'number') return null;
    if (Date.now() - s.savedAt > SESSION_TTL_MS) return null;
    return { pin: s.pin, token: s.token, name: typeof s.name === 'string' ? s.name : '' };
  } catch {
    return null;
  }
}
function loadSession(): (Seat & { soft: boolean }) | null {
  try {
    const own = readSeat(sessionStorage);
    if (own) return { ...own, soft: false };
    const shared = readSeat(localStorage);
    return shared ? { ...shared, soft: true } : null;
  } catch {
    return null;
  }
}
function saveSession(pin: string, token: string, name: string): void {
  const v = JSON.stringify({ pin, token, name, savedAt: Date.now() });
  for (const store of [() => sessionStorage, () => localStorage]) {
    try {
      store().setItem(SESSION_KEY, v);
    } catch {
      // ignore
    }
  }
}
/** Once the game is over nobody needs to get back in from another tab: only this tab keeps the seat. */
function dropSharedSeat(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}
function clearSession(): void {
  for (const store of [() => sessionStorage, () => localStorage]) {
    try {
      store().removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
  }
}

/** Leaves the finished game for good (a shared computer must not reopen it for the next student). */
function leaveGame(): void {
  clearSession();
  location.href = location.pathname;
}

// ---------- screens ----------

function render(): void {
  switch (app.stage) {
    case 'home':
      return renderHome(ui.screen, { pin: app.pin, error: app.error }, submitPin);
    case 'resume':
      return renderResume(ui.screen, app.resumeSeat?.name ?? '', resumeSharedSeat, startFresh);
    case 'name':
      return renderName(ui.screen, { name: app.name, error: app.error }, (n) => { app.name = n; go('char'); }, () => go('home'), (n) => { app.name = n; });
    case 'char':
      return renderCharacters(ui.screen, { selected: app.character, error: app.error }, (i) => { app.character = i; }, join, () => go('name'));
    case 'connecting':
      ui.screen.innerHTML = `<div class="card panel"><p>${t('net.connecting')}</p></div>`;
      return;
    case 'game':
      ui.screen.innerHTML = '';
      return;
    case 'results':
      if (app.ranking) renderResults(ui.screen, app.ranking, app.you?.id ?? null, leaveGame);
      return;
  }
}

function go(stage: Stage, error = ''): void {
  app.stage = stage;
  app.error = error;
  render();
}

async function submitPin(pin: string): Promise<void> {
  app.pin = pin;
  unlockAudio();
  try {
    const info = await getGameInfo(pin);
    if (!info.exists) return go('home', 'PIN_NOT_FOUND');
    if (info.phase !== 'LOBBY') return go('home', 'ALREADY_STARTED');
    if (info.full) return go('home', 'GAME_FULL');
    go('name');
  } catch {
    go('home', 'NETWORK');
  }
}

function join(): void {
  if (app.character < 0) return;
  unlockAudio();
  connect({ t: 'join', name: app.name, character: app.character, lang: getLang() });
}

function connect(hello: ClientMsg): void {
  app.conn?.close();
  app.hello = hello;
  app.joinRetries = 0;
  go('connecting');
  app.conn = new Connection({ url: wsUrl(app.pin), hello: () => app.hello, onMessage, onStatus });
  app.conn.open();
}

function onStatus(s: ConnStatus): void {
  if (s === 'open') {
    ui.overlay.hidden = true;
    return;
  }
  if (s === 'reconnecting' && app.stage === 'connecting' && app.hello?.t === 'join' && ++app.joinRetries > JOIN_MAX_RETRIES) {
    app.conn?.close();
    app.conn = null;
    return go('home', 'NETWORK');
  }
  if (s === 'reconnecting' && app.stage === 'game') {
    ui.overlay.hidden = false;
    ui.overlay.innerHTML = `<div class="panel"><p>${t('net.reconnecting')}</p></div>`;
    return;
  }
  if (s === 'failed') {
    if (app.stage === 'connecting') return go('home', 'NETWORK');
    if (app.stage !== 'game') return;
    ui.overlay.hidden = false;
    ui.overlay.innerHTML = `<div class="panel stack"><p>${t('net.failed')}</p><button class="btn btn-gold" type="button">${t('net.reload')}</button></div>`;
    ui.overlay.querySelector('button')!.addEventListener('click', () => location.reload());
  }
}

// ---------- server messages ----------

function onMessage(m: ServerMsg): void {
  switch (m.t) {
    case 'welcome':
      void onWelcome(m);
      return;
    case 'phase':
      return applyPhase(m.phase);
    case 'roster':
      return applyRoster(m.players);
    case 'you':
      return applyYou(m.you);
    case 'snapshot':
      if (app.stage === 'game') app.world?.applySnapshot(m.players);
      return;
    case 'teleport':
      if (app.stage === 'game') app.world?.teleport(m.floor, m.x, m.y);
      return;
    case 'question':
      return openQuestion(m.question);
    case 'answerResult':
      return onAnswerResult(m.roomId, m.correct);
    case 'ended':
      return onEnded(m.ranking);
    case 'error':
      return onError(m.code);
    default:
      return;
  }
}

async function onWelcome(m: Extract<ServerMsg, { t: 'welcome' }>): Promise<void> {
  saveSession(app.pin, m.token, m.you.name);
  // An ended game is not worth a shared copy (see dropSharedSeat).
  if (m.phase.phase === 'ENDED') dropSharedSeat();
  app.hello = { t: 'resume', token: m.token };
  app.you = m.you;
  app.roster = m.roster;
  app.phase = m.phase;
  app.offset = m.phase.serverNow - Date.now();
  let world: WorldScene;
  try {
    world = app.world ?? (await app.worldBoot!);
  } catch {
    // The game code failed to download (flaky network): the seat is saved, a reload resumes it.
    return onStatus('failed');
  }
  if (!app.world) {
    app.world = world;
    world.setCallbacks(worldCallbacks);
  }
  if (app.stage === 'results') return;
  if (app.stage !== 'game') {
    go('game');
    setupTouch();
  }
  // A request sent just before the drop may never be answered: unblock the player.
  // The room stays open on the server, so walking up to the key again brings the same question back.
  clearTimeout(app.pendingTimer);
  setFreeze('pending', false);
  if (ui.modal.isLocked) {
    ui.modal.close();
    setFreeze('question', false);
  }
  world.setRoster(app.roster);
  world.setYou(app.you!);
  spectateBar.setRoster(app.roster);
  syncPhaseUi(null);
  syncYouUi(null);
}

function applyPhase(p: PhaseInfo): void {
  const prev = app.phase?.phase ?? null;
  app.phase = p;
  app.offset = p.serverNow - Date.now();
  if (app.world && app.stage === 'game') syncPhaseUi(prev);
}

function syncPhaseUi(prev: Phase | null): void {
  const p = app.phase!;
  ui.lobbybar.hidden = p.phase !== 'LOBBY';
  renderLobbyBar();
  if (p.phase === 'COUNTDOWN' && prev !== 'COUNTDOWN' && p.countdownEndsAt) {
    app.stopCountdown?.();
    app.stopCountdown = runCountdown(ui.countdown, p.countdownEndsAt, app.offset, () => { app.stopCountdown = null; });
  }
  if (p.phase === 'PLAYING' && p.endsAt) {
    ui.hud.show();
    ui.hud.setDeadline(p.endsAt, app.offset);
  }
  if (p.phase === 'LOBBY') ui.hud.hide();
  setFreeze('countdown', p.phase === 'COUNTDOWN');
  setFreeze('ended', p.phase === 'ENDED');
}

function applyRoster(players: PublicPlayer[]): void {
  app.roster = players;
  if (!app.world || app.stage !== 'game') return;
  app.world.setRoster(players);
  spectateBar.setRoster(players);
  renderLobbyBar();
}

function applyYou(you: YouState): void {
  const prev = app.you;
  app.you = you;
  if (!app.world || app.stage !== 'game') return;
  app.world.setYou(you);
  syncYouUi(prev);
}

function syncYouUi(prev: YouState | null): void {
  const you = app.you!;
  ui.hud.set({ keys: you.keys, rooms: you.rooms, floor: you.floor });
  if (prev && !prev.floor2Unlocked && you.floor2Unlocked && you.status === 'playing') {
    toast(t('hint.floor2Open'), 'good', 3500);
    sfx.unlock();
  }
  if (you.status === 'finished') {
    if (prev && prev.status !== 'finished') {
      toast(t('finished.title'), 'good', 4000);
      sfx.fanfare();
    }
    spectateBar.setRoster(app.roster);
    spectateBar.show();
  } else {
    spectateBar.hide();
  }
}

function renderLobbyBar(): void {
  if (ui.lobbybar.hidden) return;
  ui.lobbybar.innerHTML = `PIN <b>${app.pin}</b> · 👥 ${app.roster.length}<br>${t('lobby.waiting')}`;
}

function setFreeze(reason: string, on: boolean): void {
  if (on) app.freeze.add(reason);
  else app.freeze.delete(reason);
  app.world?.setFrozen(app.freeze.size > 0);
}

// ---------- questions ----------

function openQuestion(q: QuestionView): void {
  clearTimeout(app.pendingTimer);
  setFreeze('pending', false);
  if (app.phase?.phase !== 'PLAYING') return;
  setFreeze('question', true);
  sfx.open();
  ui.modal.open(
    q,
    app.offset,
    (i) => app.conn?.send({ t: 'answer', roomId: q.roomId, optionIndex: i }),
    () => setFreeze('question', false),
  );
}

function onAnswerResult(roomId: RoomId, correct: boolean): void {
  ui.modal.showResult(correct);
  if (correct) {
    sfx.key();
    app.world?.playKeyGot(roomId);
  } else {
    sfx.wrong();
    app.world?.playWrong(roomId);
  }
  setTimeout(() => {
    ui.modal.close();
    setFreeze('question', false);
  }, RESULT_SHOW_MS);
}

function onEnded(ranking: RankedPlayer[]): void {
  app.ranking = ranking;
  dropSharedSeat();
  app.stopCountdown?.();
  ui.modal.close();
  clearTimeout(app.pendingTimer);
  setFreeze('question', false);
  setFreeze('pending', false);
  setFreeze('ended', true);
  ui.hud.hide();
  ui.lobbybar.hidden = true;
  ui.touchRoot.hidden = true;
  spectateBar.hide();
  if (app.stage !== 'results') sfx.fanfare();
  go('results');
}

function onError(code: ErrorCode): void {
  const action = errorAction(app.stage, code);
  if (code === 'BAD_TOKEN' || code === 'PIN_NOT_FOUND') clearSession();
  if (code === 'SEAT_IN_USE') {
    // The shared copy belongs to a tab that is still playing: start fresh in this one.
    app.conn?.close();
    app.conn = null;
    return go('home');
  }
  switch (action) {
    case 'ignore':
      return;
    case 'reload':
      location.reload();
      return;
    case 'home':
    case 'name':
    case 'char':
      app.conn?.close();
      app.conn = null;
      return go(action, code);
    case 'toastCloseQuestion':
      clearTimeout(app.pendingTimer);
      setFreeze('pending', false);
      if (ui.modal.isOpen) {
        ui.modal.close();
        setFreeze('question', false);
      }
      toast(t(`error.${code}`), 'bad');
      return;
    case 'toast':
      toast(t(`error.${code}`), 'bad');
  }
}

// ---------- world callbacks & touch ----------

const worldCallbacks: WorldCallbacks = {
  onMove: (x, y, dir, moving) => app.conn?.send({ t: 'move', x, y, dir, moving }),
  onInteract: (roomId) => {
    if (app.freeze.size > 0) return;
    setFreeze('pending', true);
    clearTimeout(app.pendingTimer);
    app.pendingTimer = window.setTimeout(() => setFreeze('pending', false), PENDING_TIMEOUT_MS);
    app.conn?.send({ t: 'interact', roomId, lang: getLang() });
  },
  onStairs: () => app.conn?.send({ t: 'stairs' }),
  onPrompt: (p) => {
    app.prompt = p;
    renderPrompt();
  },
};

function renderPrompt(): void {
  const p = app.prompt;
  const hint = p === 'interact' ? t(isTouchDevice() ? 'hint.interactTouch' : 'hint.interact') : p === 'stairsLocked' ? t('hint.stairsLocked') : '';
  ui.hud.set({ hint });
  app.touch?.setReady(p === 'interact');
}

function setupTouch(): void {
  if (app.touch || !isTouchDevice()) return;
  app.touch = new TouchControls(
    ui.touchRoot,
    (v) => app.world?.setTouchVector(v),
    () => app.world?.triggerAction(),
  );
}

// ---------- boot ----------

mountTopBar(byId('topbar'));
onLangChange(() => {
  document.title = t('app.title');
  if (app.stage !== 'game') render();
  renderLobbyBar();
  renderPrompt();
  ui.hud.render();
  spectateBar.render();
  app.world?.refreshLang();
});
document.title = t('app.title');
// Phaser is most of the download: load it in the background so the PIN screen appears at once.
app.worldBoot = import('./game/WorldScene').then((m) => m.bootWorld('game'));

// A phone that slept or lost Wi-Fi reconnects as soon as it is usable again.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') app.conn?.wake();
});
window.addEventListener('online', () => app.conn?.wake());

function resumeSharedSeat(): void {
  const seat = app.resumeSeat;
  app.resumeSeat = null;
  if (!seat) return go('home');
  app.pin = seat.pin;
  connect({ t: 'resume', token: seat.token, soft: true });
}

/** "That is not me": forget the other student's seat and start at the PIN form. */
function startFresh(): void {
  app.resumeSeat = null;
  clearSession();
  go('home');
}

const session = loadSession();
// A link with another PIN means a new game: do not drop the student back into an old one.
const linkPin = new URLSearchParams(location.search).get('pin')?.replace(/\D/g, '');
if (session && linkPin && linkPin !== session.pin) clearSession();
if (!session || (linkPin && linkPin !== session.pin)) {
  go('home');
} else if (session.soft) {
  app.resumeSeat = session;
  go('resume');
} else {
  app.pin = session.pin;
  connect({ t: 'resume', token: session.token });
}
