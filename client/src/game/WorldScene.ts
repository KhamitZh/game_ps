import Phaser from 'phaser';
import { TILE } from '../../../shared/src/constants';
import { MAPS, ROOMS, nearPedestal, onStairs, tileCenter, type FloorId, type RoomId } from '../../../shared/src/map';
import type { Dir, PosEntry, PublicPlayer, YouState } from '../../../shared/src/protocol';
import { rank } from '../../../shared/src/ranking';
import { sfx } from '../audio/sfx';
import { t } from '../i18n';
import { Avatar } from './Avatar';
import { Interp } from './interp';
import { dirFromVec, stepMovement } from './movement';
import { ensureMapTexture, registerTextures } from './textures';

export interface WorldCallbacks {
  onMove(x: number, y: number, dir: Dir, moving: boolean): void;
  onInteract(roomId: RoomId): void;
  onStairs(): void;
  onPrompt(prompt: 'interact' | 'stairsLocked' | null): void;
}

type Prompt = 'interact' | 'stairsLocked' | null;
type Keys = Record<'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'E', Phaser.Input.Keyboard.Key>;

const SEND_MS = 100;
const INTERP_DELAY_MS = 120;
const STEP_SOUND_MS = 280;
const SNAP_DISTANCE = 64;
const TEXT_STYLE = { fontFamily: 'Rubik, sans-serif', resolution: 2 } as const;

export class WorldScene extends Phaser.Scene {
  private cb: WorldCallbacks | null = null;
  private you: YouState | null = null;
  private roster = new Map<string, PublicPlayer>();
  private localFloor: FloorId = 'lobby';
  private viewFloor: FloorId | null = null;
  private pos = { x: 0, y: 0 };
  private dir: Dir = 'down';
  private moving = false;
  private frozen = true;
  private me: Avatar | null = null;
  private others = new Map<string, { avatar: Avatar; interp: Interp }>();
  private mapImage: Phaser.GameObjects.Image | null = null;
  private overlay: Phaser.GameObjects.GameObject[] = [];
  private keySprites = new Map<RoomId, Phaser.GameObjects.Image>();
  private chain: Phaser.GameObjects.Image | null = null;
  private board: Phaser.GameObjects.Text | null = null;
  private keys!: Keys;
  private touchVec = { x: 0, y: 0 };
  private actionQueued = false;
  private lastSend = 0;
  private dirty = false;
  private stairsLatch = false;
  private prompt: Prompt = null;
  private promptRoom: RoomId | null = null;
  private spectateId: string | null = null;
  private lastStepSound = 0;

  constructor(private readonly onReady?: () => void) {
    super('world');
  }

  create(): void {
    registerTextures(this);
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,E', false) as Keys;
    this.cameras.main.setRoundPixels(true);
    this.applyZoom();
    this.scale.on('resize', () => this.applyZoom());
    this.onReady?.();
  }

  // ---------- inputs from the app ----------

  setCallbacks(cb: WorldCallbacks): void {
    this.cb = cb;
  }

  setFrozen(frozen: boolean): void {
    this.frozen = frozen;
  }

  setTouchVector(v: { x: number; y: number }): void {
    this.touchVec = v;
  }

  triggerAction(): void {
    this.actionQueued = true;
  }

  setRoster(players: PublicPlayer[]): void {
    this.roster = new Map(players.map((p) => [p.id, p]));
    for (const [id, o] of this.others) {
      const p = this.roster.get(id);
      if (p) {
        o.avatar.setName(p.name);
        o.avatar.setCharacter(p.character);
      }
    }
    this.refreshBoard();
    if (this.spectateId) {
      const target = this.roster.get(this.spectateId);
      if (target && target.floor !== this.viewFloor) this.showFloor(target.floor);
    }
  }

  setYou(you: YouState): void {
    const prev = this.you;
    this.you = you;
    if (!this.me) this.me = new Avatar(this, you.character, you.name, true);
    this.me.setCharacter(you.character);
    this.me.setName(you.name);
    if (!prev) {
      this.teleport(you.floor, you.x, you.y);
      return;
    }
    if (!prev.floor2Unlocked && you.floor2Unlocked && this.chain) {
      const c = this.chain;
      this.chain = null;
      this.tweens.add({ targets: c, y: c.y + 24, alpha: 0, duration: 700, ease: 'Quad.easeIn', onComplete: () => c.destroy() });
    }
    this.rebuildOverlay();
  }

  teleport(floor: FloorId, x: number, y: number): void {
    this.localFloor = floor;
    this.pos = { x, y };
    this.moving = false;
    this.stairsLatch = onStairs(MAPS[floor], x, y);
    this.me?.setPos(x, y);
    this.me?.anim(this.dir, false);
    if (!this.spectateId) this.showFloor(floor);
    else this.syncMeVisibility();
  }

  applySnapshot(entries: PosEntry[]): void {
    const now = performance.now();
    const seen = new Set<string>();
    for (const e of entries) {
      if (e.id === this.you?.id || e.floor !== this.viewFloor) continue;
      seen.add(e.id);
      let o = this.others.get(e.id);
      if (!o) {
        const info = this.roster.get(e.id);
        o = { avatar: new Avatar(this, info?.character ?? 0, info?.name ?? '…'), interp: new Interp() };
        this.others.set(e.id, o);
        o.avatar.setPos(e.x, e.y);
        if (e.id === this.spectateId) this.follow();
      }
      const last = o.interp.last();
      if (last && Math.hypot(last.x - e.x, last.y - e.y) > SNAP_DISTANCE) o.interp.reset();
      o.interp.push(now, e.x, e.y);
      o.avatar.anim(e.dir, e.moving);
    }
    for (const [id, o] of this.others) {
      if (seen.has(id)) continue;
      o.avatar.destroy();
      this.others.delete(id);
      if (id === this.spectateId) this.follow();
    }
  }

  spectate(targetId: string | null): void {
    this.spectateId = targetId;
    const target = targetId ? this.roster.get(targetId) : undefined;
    this.showFloor(target ? target.floor : this.localFloor);
  }

  refreshLang(): void {
    this.rebuildOverlay();
  }

  // ---------- effects ----------

  playKeyGot(roomId: RoomId): void {
    const room = ROOMS[roomId];
    const p = tileCenter(room.pedestal.x, room.pedestal.y);
    const burst = this.add
      .particles(p.x, p.y - 14, 'particle', {
        speed: { min: 60, max: 160 },
        lifespan: 700,
        scale: { start: 1.5, end: 0 },
        tint: [0xffd54a, 0xffffff, 0xffb300],
        emitting: false,
      })
      .setDepth(30_000);
    burst.explode(24);
    this.time.delayedCall(900, () => burst.destroy());
    const key = this.detachKey(roomId);
    if (key) {
      this.tweens.add({ targets: key, y: key.y - 60, scale: 3, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => key.destroy() });
    }
  }

  playWrong(roomId: RoomId): void {
    this.cameras.main.shake(220, 0.006);
    const key = this.detachKey(roomId);
    if (key) {
      key.setTint(0xff4444);
      this.tweens.add({ targets: key, alpha: 0, angle: 90, y: key.y + 10, duration: 600, onComplete: () => key.destroy() });
    }
  }

  /** Removes a key sprite from the overlay so a rebuild does not kill its animation. */
  private detachKey(roomId: RoomId): Phaser.GameObjects.Image | null {
    const key = this.keySprites.get(roomId);
    if (!key) return null;
    this.keySprites.delete(roomId);
    this.overlay = this.overlay.filter((o) => o !== key);
    this.tweens.killTweensOf(key);
    return key;
  }

  // ---------- frame loop ----------

  update(_time: number, delta: number): void {
    const now = performance.now();
    const renderT = now - INTERP_DELAY_MS;
    for (const o of this.others.values()) {
      const s = o.interp.sample(renderT);
      if (s) o.avatar.setPos(s.x, s.y);
    }
    if (!this.me || !this.you || this.spectateId || this.viewFloor !== this.localFloor) return;

    const map = MAPS[this.localFloor];
    const answered = new Set(Object.keys(this.you.answered) as RoomId[]);
    let vec = { x: 0, y: 0 };
    if (!this.frozen) {
      const k = this.keys;
      vec.x = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
      vec.y = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
      if (vec.x === 0 && vec.y === 0) vec = { ...this.touchVec };
    }
    const next = stepMovement(map, this.pos, vec, delta, answered);
    const moving = next.x !== this.pos.x || next.y !== this.pos.y;
    if (moving || moving !== this.moving) this.dirty = true;
    if (moving && now - this.lastStepSound > STEP_SOUND_MS) {
      sfx.step();
      this.lastStepSound = now;
    }
    this.dir = dirFromVec(vec, this.dir);
    this.pos = next;
    this.moving = moving;
    this.me.setPos(next.x, next.y);
    this.me.anim(this.dir, moving);
    if (this.dirty && now - this.lastSend >= SEND_MS) this.flushMove(now);

    this.checkStairs();
    this.checkPrompt();
    const pressed = Phaser.Input.Keyboard.JustDown(this.keys.E) || this.actionQueued;
    this.actionQueued = false;
    if (pressed && !this.frozen && this.promptRoom) this.cb?.onInteract(this.promptRoom);
  }

  private flushMove(now = performance.now()): void {
    this.cb?.onMove(Math.round(this.pos.x * 10) / 10, Math.round(this.pos.y * 10) / 10, this.dir, this.moving);
    this.lastSend = now;
    this.dirty = false;
  }

  private checkStairs(): void {
    const on = onStairs(MAPS[this.localFloor], this.pos.x, this.pos.y);
    if (on && !this.stairsLatch) {
      this.stairsLatch = true;
      const locked = this.localFloor === 'f1' && !this.you?.floor2Unlocked;
      if (!locked && this.you?.status === 'playing') {
        this.flushMove();
        this.cb?.onStairs();
      }
    } else if (!on) {
      this.stairsLatch = false;
    }
  }

  private checkPrompt(): void {
    const map = MAPS[this.localFloor];
    let room: RoomId | null = null;
    if (this.you?.status === 'playing') {
      for (const r of map.rooms) {
        if (!this.you.answered[r.id] && nearPedestal(r, this.pos.x, this.pos.y)) {
          room = r.id;
          break;
        }
      }
    }
    const locked = this.localFloor === 'f1' && !this.you?.floor2Unlocked && onStairs(map, this.pos.x, this.pos.y);
    const prompt: Prompt = room ? 'interact' : locked ? 'stairsLocked' : null;
    this.promptRoom = room;
    if (prompt !== this.prompt) {
      this.prompt = prompt;
      this.cb?.onPrompt(prompt);
    }
  }

  // ---------- floor rendering ----------

  private showFloor(floor: FloorId): void {
    if (this.viewFloor !== floor) {
      this.viewFloor = floor;
      this.mapImage?.destroy();
      const map = MAPS[floor];
      this.mapImage = this.add.image(0, 0, ensureMapTexture(this, floor)).setOrigin(0, 0).setDepth(-10_000);
      this.cameras.main.setBounds(0, 0, map.width * TILE, map.height * TILE);
      for (const o of this.others.values()) o.avatar.destroy();
      this.others.clear();
    }
    this.rebuildOverlay();
    this.syncMeVisibility();
    this.follow();
  }

  private syncMeVisibility(): void {
    this.me?.setVisible(!this.spectateId && this.viewFloor === this.localFloor);
  }

  private follow(): void {
    const cam = this.cameras.main;
    const target = this.spectateId ? this.others.get(this.spectateId)?.avatar.sprite : this.me?.sprite;
    if (target) cam.startFollow(target, true, 0.15, 0.15, 0, 24);
    else cam.stopFollow();
  }

  private applyZoom(): void {
    const m = Math.min(this.scale.width, this.scale.height);
    this.cameras.main.setZoom(m < 500 ? 1.25 : m < 800 ? 2 : m < 1100 ? 2.5 : 3);
  }

  private rebuildOverlay(): void {
    for (const o of this.overlay) o.destroy();
    this.overlay = [];
    this.keySprites.clear();
    this.chain?.destroy();
    this.chain = null;
    this.board = null;
    const floor = this.viewFloor;
    if (!floor) return;
    const map = MAPS[floor];
    const you = this.you;
    const showMine = !!you && you.status === 'playing' && you.floor === floor && !this.spectateId;

    for (const room of map.rooms) {
      const label = this.add
        .text((room.rect.x + room.rect.w / 2) * TILE, room.rect.y * TILE + 4, t(`room.${room.id}`), {
          ...TEXT_STYLE,
          fontSize: '11px',
          color: '#ffffff',
          backgroundColor: '#00000066',
          padding: { x: 4, y: 1 },
        })
        .setOrigin(0.5, 0)
        .setDepth(25_000);
      this.overlay.push(label);
      if (!showMine) continue;
      const mark = you!.answered[room.id];
      if (mark) {
        const d = tileCenter(room.door.x, room.door.y);
        this.overlay.push(this.add.image(d.x, d.y, mark === 'correct' ? 'mark-correct' : 'mark-wrong').setScale(1.5).setDepth(25_000));
        continue;
      }
      const p = tileCenter(room.pedestal.x, room.pedestal.y);
      const key = this.add.image(p.x, p.y - 14, 'key').setScale(1.5).setDepth(p.y + 1);
      key.preFX?.addGlow(0xffe066, 4, 0, false, 0.1, 10);
      this.tweens.add({ targets: key, y: key.y - 5, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.keySprites.set(room.id, key);
      this.overlay.push(key);
    }

    if (floor === 'f1' && map.stairs && !you?.floor2Unlocked) {
      const s = map.stairs;
      this.chain = this.add.image((s.x + s.w / 2) * TILE, (s.y + s.h / 2) * TILE, 'chain').setDepth(24_000);
    }

    if (floor === 'lobby') {
      this.board = this.add
        .text(12 * TILE, TILE + 6, '', { ...TEXT_STYLE, fontSize: '12px', color: '#7cffb2', align: 'center', lineSpacing: 1 })
        .setOrigin(0.5, 0)
        .setDepth(25_000);
      this.overlay.push(this.board);
      this.refreshBoard();
    }
  }

  private refreshBoard(): void {
    if (!this.board) return;
    const top = rank([...this.roster.values()]).slice(0, 5);
    const lines = top.map((p) => `${p.place}. ${p.name}  🔑${p.keys}  🚪${p.rooms}`);
    this.board.setText([t('board.title'), ...lines].join('\n'));
  }
}

export function bootWorld(parentId: string): Promise<WorldScene> {
  return new Promise((resolve) => {
    const scene: WorldScene = new WorldScene(() => resolve(scene));
    new Phaser.Game({
      type: Phaser.AUTO,
      parent: parentId,
      pixelArt: true,
      roundPixels: true,
      backgroundColor: '#14121f',
      banner: false,
      scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
      input: { activePointers: 3 },
      scene,
    });
  });
}
