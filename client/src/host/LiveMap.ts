import Phaser from 'phaser';
import { TILE } from '../../../shared/src/constants';
import { MAPS, type FloorId } from '../../../shared/src/map';
import type { PosEntry, PublicPlayer } from '../../../shared/src/protocol';
import { Avatar } from '../game/Avatar';
import { Interp } from '../game/interp';
import { ensureMapTexture, registerTextures } from '../game/textures';
import { t } from '../i18n';

export type View = 'all' | FloorId;

const GAP = 2 * TILE;
const TITLE_H = 30;
const INTERP_DELAY_MS = 120;
const SNAP_DISTANCE = 64;
const FLOORS: FloorId[] = ['f1', 'f2', 'lobby'];

/** Where each floor's map sits in the host's world: floors 1 and 2 side by side, the lobby under them. */
function layout(): Record<FloorId, { x: number; y: number; w: number; h: number }> {
  const f = (id: FloorId) => ({ w: MAPS[id].width * TILE, h: MAPS[id].height * TILE });
  const f1 = f('f1'), f2 = f('f2'), lobby = f('lobby');
  const top = TITLE_H;
  const width = f1.w + GAP + f2.w;
  return {
    f1: { x: 0, y: top, ...f1 },
    f2: { x: f1.w + GAP, y: top, ...f2 },
    lobby: { x: (width - lobby.w) / 2, y: top + Math.max(f1.h, f2.h) + GAP + TITLE_H, ...lobby },
  };
}
const LAYOUT = layout();
const WORLD = {
  w: LAYOUT.f2.x + LAYOUT.f2.w,
  h: LAYOUT.lobby.y + LAYOUT.lobby.h,
};

/** The teacher's live view: every floor at once, every online player walking around, click to pick one. */
export class LiveMapScene extends Phaser.Scene {
  private roster = new Map<string, PublicPlayer>();
  private avatars = new Map<string, { avatar: Avatar; interp: Interp; floor: FloorId }>();
  private titles: Phaser.GameObjects.Text[] = [];
  private view: View = 'all';
  private selected: string | null = null;

  constructor(
    private readonly onReady: () => void,
    private readonly onSelect: (id: string) => void,
    private readonly onCount: (n: number) => void,
  ) {
    super('live');
  }

  create(): void {
    registerTextures(this);
    for (const floor of FLOORS) {
      const L = LAYOUT[floor];
      this.add.image(L.x, L.y, ensureMapTexture(this, floor)).setOrigin(0, 0).setDepth(-10_000);
      for (const room of MAPS[floor].rooms) {
        this.add
          .text(L.x + (room.rect.x + room.rect.w / 2) * TILE, L.y + room.rect.y * TILE + 4, t(`room.${room.id}`), {
            fontFamily: 'Rubik, sans-serif', fontSize: '11px', color: '#ffffff', backgroundColor: '#00000066',
            padding: { x: 4, y: 1 }, resolution: 2,
          })
          .setOrigin(0.5, 0)
          .setDepth(25_000);
      }
    }
    this.drawTitles();
    this.cameras.main.setBackgroundColor('#14121f').setRoundPixels(true);
    this.scale.on('resize', () => this.fit());
    this.fit();
    this.onReady();
  }

  setView(view: View): void {
    this.view = view;
    this.fit();
  }

  setRoster(players: PublicPlayer[]): void {
    this.roster = new Map(players.map((p) => [p.id, p]));
    for (const [id, o] of this.avatars) this.label(id, o.avatar);
  }

  select(id: string | null): void {
    const prev = this.selected;
    this.selected = id;
    for (const pid of [prev, id]) {
      const o = pid ? this.avatars.get(pid) : undefined;
      if (o && pid) this.label(pid, o.avatar);
    }
    const o = id ? this.avatars.get(id) : undefined;
    if (o && this.view !== 'all' && this.view !== o.floor) this.setView(o.floor);
  }

  /** Stops drawing while the map is not on screen (results, login); wake() resumes. */
  sleep(): void {
    this.game.loop.sleep();
  }

  wake(): void {
    this.game.loop.wake();
    this.fit();
  }

  refreshLang(): void {
    this.drawTitles();
  }

  applySnapshot(entries: PosEntry[]): void {
    const now = performance.now();
    const seen = new Set<string>();
    for (const e of entries) {
      seen.add(e.id);
      const L = LAYOUT[e.floor];
      const x = L.x + e.x, y = L.y + e.y;
      let o = this.avatars.get(e.id);
      if (!o) {
        const info = this.roster.get(e.id);
        const avatar = new Avatar(this, info?.character ?? 0, info?.name ?? '…');
        avatar.sprite.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.onSelect(e.id));
        o = { avatar, interp: new Interp(), floor: e.floor };
        this.avatars.set(e.id, o);
        avatar.setPos(x, y);
        this.label(e.id, avatar);
      }
      const last = o.interp.last();
      // Changing floors (stairs, finishing) is a jump across the world: do not slide there.
      if (o.floor !== e.floor || (last && Math.hypot(last.x - x, last.y - y) > SNAP_DISTANCE)) o.interp.reset();
      o.floor = e.floor;
      o.interp.push(now, x, y);
      o.avatar.anim(e.dir, e.moving);
    }
    for (const [id, o] of this.avatars) {
      if (seen.has(id)) continue;
      o.avatar.destroy();
      this.avatars.delete(id);
    }
    this.onCount(this.avatars.size);
  }

  update(): void {
    const renderT = performance.now() - INTERP_DELAY_MS;
    for (const o of this.avatars.values()) {
      const s = o.interp.sample(renderT);
      if (s) o.avatar.setPos(s.x, s.y);
    }
  }

  private label(id: string, avatar: Avatar): void {
    const p = this.roster.get(id);
    if (!p) return;
    avatar.setCharacter(p.character);
    avatar.setName(`${p.name} 🔑${p.keys}`);
    avatar.setHighlight(id === this.selected);
  }

  private drawTitles(): void {
    for (const x of this.titles) x.destroy();
    this.titles = FLOORS.map((floor) => {
      const L = LAYOUT[floor];
      return this.add
        .text(L.x + L.w / 2, L.y - 6, t(`floor.${floor}`), {
          fontFamily: 'Rubik, sans-serif', fontSize: '20px', fontStyle: 'bold', color: '#ffd54a', resolution: 2,
        })
        .setOrigin(0.5, 1)
        .setDepth(25_000);
    });
  }

  /** Zooms the camera so the chosen part of the house fills the view. */
  private fit(): void {
    const cam = this.cameras.main;
    const area = this.view === 'all'
      ? { x: 0, y: 0, w: WORLD.w, h: WORLD.h }
      : { x: LAYOUT[this.view].x, y: LAYOUT[this.view].y - TITLE_H, w: LAYOUT[this.view].w, h: LAYOUT[this.view].h + TITLE_H };
    const pad = 16;
    const zoom = Math.min((this.scale.width - pad) / area.w, (this.scale.height - pad) / area.h);
    cam.setZoom(Math.max(zoom, 0.1));
    cam.centerOn(area.x + area.w / 2, area.y + area.h / 2);
  }
}

export function bootLiveMap(parent: HTMLElement, onSelect: (id: string) => void, onCount: (n: number) => void): Promise<LiveMapScene> {
  return new Promise((resolve) => {
    const scene: LiveMapScene = new LiveMapScene(() => resolve(scene), onSelect, onCount);
    new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      pixelArt: true,
      roundPixels: true,
      backgroundColor: '#14121f',
      banner: false,
      scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
      // A watching view: 30 fps is smooth enough and leaves the teacher's computer (and projector) cool.
      fps: { target: 30, limit: 30 },
      scene,
    });
  });
}
