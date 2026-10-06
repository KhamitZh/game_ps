import Phaser from 'phaser';
import { CHARACTER_COUNT } from '../../../shared/src/constants';
import { MAPS, type FloorId } from '../../../shared/src/map';
import { CHAR_H, CHAR_W, DIRS, buildCharacterSheet, characterLook, charKey } from '../art/characters';
import { drawMap, itemCanvases } from '../art/tiles';

export function registerTextures(scene: Phaser.Scene): void {
  for (let i = 0; i < CHARACTER_COUNT; i++) {
    const key = charKey(i);
    if (scene.textures.exists(key)) continue;
    const tex = scene.textures.addCanvas(key, buildCharacterSheet(characterLook(i)))!;
    DIRS.forEach((dir, row) => {
      for (let f = 0; f < 3; f++) tex.add(`${dir}-${f}`, 0, f * CHAR_W, row * CHAR_H, CHAR_W, CHAR_H);
    });
    for (const dir of DIRS) {
      scene.anims.create({
        key: `${key}-${dir}`,
        frames: [0, 1, 0, 2].map((f) => ({ key, frame: `${dir}-${f}` })),
        frameRate: 8,
        repeat: -1,
      });
    }
  }
  for (const [name, canvas] of Object.entries(itemCanvases())) {
    if (!scene.textures.exists(name)) scene.textures.addCanvas(name, canvas);
  }
}

export function ensureMapTexture(scene: Phaser.Scene, floor: FloorId): string {
  const key = `map-${floor}`;
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, drawMap(MAPS[floor]));
  return key;
}
