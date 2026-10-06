import './ui/styles.css';
import type { RankedPlayer } from '../../shared/src/ranking';
import type { ClientMsg, ErrorCode, Phase, PhaseInfo, PublicPlayer, QuestionView, ServerMsg, YouState } from '../../shared/src/protocol';
import type { RoomId } from '../../shared/src/map';
import { sfx, unlockAudio } from './audio/sfx';
import { wsUrl } from './config';
import { errorAction, type Stage } from './errorRouting';
import { bootWorld, type WorldCallbacks, type WorldScene } from './game/WorldScene';
import { getLang, onLangChange, t } from './i18n';
import { getGameInfo } from './net/api';
import { Connection, type ConnStatus } from './net/connection';
import { runCountdown } from './ui/countdown';
import { byId } from './ui/dom';
import { Hud } from './ui/hud';
import { renderResults } from './ui/podium';
import { QuestionModal } from './ui/question';
import { renderCharacters, renderHome, renderName } from './ui/screens';
import { SpectateBar } from './ui/spectate';
import { toast } from './ui/toast';
import { mountTopBar } from './ui/topbar';
import { TouchControls, isTouchDevice } from './ui/touch';

type Prompt = 'interact' | 'stairsLocked' | null;

const SESSION_KEY = 'kh.session';
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
};

const spectateBar = new SpectateBar(byId('spectate'), (id) => {
  app.conn?.send({ t: 'spectate', targetId: id });
  app.world?.spectate(id);
});

// ---------- session ----------

function loadSession(): { pin: string; token: string } | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
    return s && typeof s.pin === 'string' && typeof s.token === 'string' ? s : null;
  } catch {
    return null;
  }
}
function saveSession(pin: string, token: string): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ pin, token }));
  } catch {
    // ignore
  }
}
function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

// ---------- screens ----------

function render(): void {
  switch (app.stage) {
    case 'home':
      return renderHome(ui.screen, { pin: app.pin, error: app.error }, submitPin);
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
      if (app.ranking) renderResults(ui.screen, app.ranking, app.you?.id ?? null);
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
  go('connecting');
  app.conn = new Connection({ url: wsUrl(app.pin), hello: () => app.hello, onMessage, onStatus });
  app.conn.open();
}

function onStatus(s: ConnStatus): void {
  if (s === 'open') {
    ui.overlay.hidden = true;
    return;
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
  saveSession(app.pin, m.token);
  app.hello = { t: 'resume', token: m.token };
  app.you = m.you;
  app.roster = m.roster;
  app.phase = m.phase;
  app.offset = m.phase.serverNow - Date.now();
  const world = app.world ?? (await app.worldBoot!);
  if (!app.world) {
    app.world = world;
    world.setCallbacks(worldCallbacks);
  }
  if (app.stage === 'results') return;
  if (app.stage !== 'game') {
    go('game');
    setupTouch();
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
    app.conn?.send({ t: 'interact', roomId });
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
app.worldBoot = bootWorld('game');

const session = loadSession();
if (session) {
  app.pin = session.pin;
  connect({ t: 'resume', token: session.token });
} else {
  go('home');
}
