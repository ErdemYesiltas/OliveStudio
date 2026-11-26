import {
  Container, Graphics, MeshPlane, MeshRope, Rectangle, Sprite, Texture,
} from 'pixi.js';
import type { SceneObject } from './scene';

export function meshPlane(node: Extract<SceneObject, { type: 'MeshPlane' }>, texture: Texture) {
  const mesh = new MeshPlane({ texture, verticesX: node.columns, verticesY: node.rows });
  const geometry = mesh.geometry;
  mesh.autoResize = false;
  const positions = geometry.positions;
  for (let index = 0; index < positions.length; index += 2) {
    const u = positions[index] / texture.width;
    positions[index] = u * node.width;
    positions[index + 1] = positions[index + 1] / texture.height * node.height + node.bend * Math.sin(u * Math.PI);
  }
  geometry.getBuffer('aPosition').update();
  mesh.once('destroyed', () => geometry.destroy());
  return mesh;
}

export function meshRope(node: Extract<SceneObject, { type: 'MeshRope' }>, texture: Texture) {
  const points = Array.from({ length: node.segments }, (_, index) => {
    const ratio = index / (node.segments - 1);
    return { x: ratio * node.length, y: node.bend * Math.sin(ratio * Math.PI) };
  });
  const mesh = new MeshRope({ points, texture, width: node.thickness });
  mesh.autoUpdate = false;
  const geometry = mesh.geometry;
  mesh.once('destroyed', () => geometry.destroy());
  return mesh;
}

export function tilemap(node: Extract<SceneObject, { type: 'Tilemap' }>, texture?: Texture) {
  const { columns, rows, tileWidth, tileHeight } = node;
  const view = new Container();
  view.boundsArea = new Rectangle(0, 0, columns * tileWidth, rows * tileHeight);
  if (!texture || !node.tiles.some(index => index >= 0)) {
    const grid = new Graphics();
    for (let x = 0; x <= columns * tileWidth; x += tileWidth) grid.moveTo(x, 0).lineTo(x, rows * tileHeight);
    for (let y = 0; y <= rows * tileHeight; y += tileHeight) grid.moveTo(0, y).lineTo(columns * tileWidth, y);
    view.addChild(grid.stroke({ color: '#79a784', width: 1, alpha: 0.5 }));
  }
  if (!texture) return view;
  const sourceColumns = Math.floor(texture.width / tileWidth);
  const sourceRows = Math.floor(texture.height / tileHeight);
  const frames = new Map<number, Texture>();
  node.tiles.forEach((tile, index) => {
    if (tile < 0 || tile >= sourceColumns * sourceRows) return;
    let frame = frames.get(tile);
    if (!frame) {
      frame = new Texture({
        source: texture.source,
        frame: new Rectangle((tile % sourceColumns) * tileWidth, Math.floor(tile / sourceColumns) * tileHeight, tileWidth, tileHeight),
      });
      frames.set(tile, frame);
    }
    const sprite = new Sprite(frame);
    sprite.position.set((index % columns) * tileWidth, Math.floor(index / columns) * tileHeight);
    view.addChild(sprite);
  });
  view.once('destroyed', () => { for (const frame of frames.values()) frame.destroy(false); });
  return view;
}
