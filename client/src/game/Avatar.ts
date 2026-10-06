import Phaser from 'phaser';
import type { Dir } from '../../../shared/src/protocol';
import { charKey } from '../art/characters';

const LABEL_OFFSET = 50;

export class Avatar {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly label: Phaser.GameObjects.Text;
  private character: number;
  private dir: Dir = 'down';
  private moving = false;

  constructor(scene: Phaser.Scene, character: number, name: string, isMe = false) {
    this.character = character;
    this.sprite = scene.add.sprite(0, 0, charKey(character), 'down-0').setOrigin(0.5, 1).setScale(2);
    this.label = scene.add
      .text(0, 0, name, {
        fontFamily: 'Rubik, sans-serif',
        fontSize: '12px',
        color: isMe ? '#ffe066' : '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5, 1);
  }

  setCharacter(c: number): void {
    if (c === this.character) return;
    this.character = c;
    this.sprite.setTexture(charKey(c), `${this.dir}-0`);
    this.anim(this.dir, this.moving, true);
  }

  setName(name: string): void {
    if (this.label.text !== name) this.label.setText(name);
  }

  setPos(x: number, y: number): void {
    const rx = Math.round(x), ry = Math.round(y);
    this.sprite.setPosition(rx, ry).setDepth(ry);
    this.label.setPosition(rx, ry - LABEL_OFFSET).setDepth(20_000 + ry);
  }

  anim(dir: Dir, moving: boolean, force = false): void {
    if (!force && dir === this.dir && moving === this.moving) return;
    this.dir = dir;
    this.moving = moving;
    if (moving) this.sprite.play(`${charKey(this.character)}-${dir}`, true);
    else {
      this.sprite.stop();
      this.sprite.setFrame(`${dir}-0`);
    }
  }

  setVisible(v: boolean): void {
    this.sprite.setVisible(v);
    this.label.setVisible(v);
  }

  destroy(): void {
    this.sprite.destroy();
    this.label.destroy();
  }
}
