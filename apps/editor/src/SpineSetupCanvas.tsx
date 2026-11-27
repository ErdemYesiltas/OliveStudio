import { useEffect, useMemo, useRef, useState } from 'react';
import { Vector2 } from '@esotericsoftware/spine-core';
import type { SpineBone, SpineMeshPoint } from '@olivestudio/engine/spine-format';
import { t } from './i18n';
import { validationMessage } from './scene';
import { spineLocalDelta, spineLocalPoint, spineSetupSkeleton } from './spinePose';

const width = 260, height = 200;
type BoneDrag = { index: number; pointer: number; start: SpineMeshPoint } &
  ({ kind: 'move'; branch: Set<number> } | { kind: 'draw' });
type DrawnBone = Required<Pick<SpineBone, 'parent' | 'x' | 'y' | 'length' | 'rotation'>>;

export function SpineSetupCanvas({ bones, selected, disabled, select, move, draw, report }: {
  bones: SpineBone[]; selected: string; disabled: boolean; select: (name: string) => void;
  move: (name: string, point: SpineMeshPoint) => void; report: (error: string) => void;
  draw?: (bone: DrawnBone) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<BoneDrag>(null);
  const [movement, setMovement] = useState<SpineMeshPoint>();
  const skeleton = useMemo(() => spineSetupSkeleton(bones), [bones]);
  const joints = useMemo(() => skeleton.bones.map(bone => ({
    position: { x: bone.worldX, y: bone.worldY }, tip: bone.localToWorld(new Vector2(bone.data.length, 0)),
    parent: bone.parent?.data.index, name: bone.data.name,
  })), [skeleton]);
  const bounds = joints.reduce((bounds, { position, tip }) => ({
    left: Math.min(bounds.left, position.x, tip.x), right: Math.max(bounds.right, position.x, tip.x),
    bottom: Math.min(bounds.bottom, position.y, tip.y), top: Math.max(bounds.top, position.y, tip.y),
  }), { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity });
  const scale = Math.min((width - 48) / Math.max(32, bounds.right - bounds.left), (height - 48) / Math.max(32, bounds.top - bounds.bottom), 4);
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  const projected = (point: SpineMeshPoint, index: number) => ({
    x: width / 2 + (point.x - centerX) * scale + (drag.current?.kind === 'move' && drag.current.branch.has(index) ? movement?.x ?? 0 : 0),
    y: height / 2 - (point.y - centerY) * scale + (drag.current?.kind === 'move' && drag.current.branch.has(index) ? movement?.y ?? 0 : 0),
  });
  useEffect(() => {
    if (!canvas.current) return;
    const ctx = canvas.current.getContext('2d');
    if (!ctx) return;
    const style = getComputedStyle(canvas.current);
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = style.getPropertyValue('--muted');
    joints.forEach((joint, index) => {
      if (joint.parent === undefined) return;
      const a = projected(joints[joint.parent].position, joint.parent), b = projected(joint.position, index);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    });
    ctx.setLineDash([]);
    joints.forEach((joint, index) => {
      const a = projected(joint.position, index), b = projected(joint.tip, index);
      const color = style.getPropertyValue(joint.name === selected ? '--accent' : '--text');
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.lineWidth = joint.name === selected ? 3 : 1.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.beginPath(); ctx.arc(a.x, a.y, joint.name === selected ? 5 : 3, 0, Math.PI * 2); ctx.fill();
    });
    if (drag.current?.kind === 'draw' && movement) {
      const { x, y } = drag.current.start;
      ctx.strokeStyle = style.getPropertyValue('--accent');
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + movement.x, y + movement.y); ctx.stroke();
    }
  });
  const moveJoint = (index: number, dx: number, dy: number) => {
    try {
      const joint = joints[index], bone = bones[index];
      const local = joint.parent === undefined ? { x: dx / skeleton.scaleX, y: dy / skeleton.scaleY } :
        spineLocalDelta(skeleton, joint.parent, dx, dy);
      move(bone.name, { x: (bone.x ?? 0) + local.x, y: (bone.y ?? 0) + local.y });
    } catch (error) { report(validationMessage(error)); }
  };
  const locate = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left) * width / rect.width, y: (clientY - rect.top) * height / rect.height };
  };
  function drawBone(index: number, start: SpineMeshPoint, end: SpineMeshPoint) {
    if (!draw) return;
    try {
      const toLocal = ({ x, y }: SpineMeshPoint) => spineLocalPoint(skeleton, index,
        new Vector2(centerX + (x - width / 2) / scale, centerY - (y - height / 2) / scale));
      const origin = toLocal(start), tip = toLocal(end);
      const dx = tip.x - origin.x, dy = tip.y - origin.y;
      draw({ parent: bones[index].name, x: origin.x, y: origin.y, length: Math.hypot(dx, dy), rotation: Math.atan2(dy, dx) * 180 / Math.PI });
    } catch (error) { report(validationMessage(error)); }
  }
  return <canvas ref={canvas} className="spine-uv-canvas" data-drawing-bone={!!draw || undefined}
    aria-label={t('spineBoneLayout')} width={width} height={height} tabIndex={disabled ? -1 : 0}
    onKeyDown={event => {
      if (disabled || draw) return;
      const step = event.shiftKey ? 10 : 1;
      const nudges = new Map([['ArrowLeft', [-step, 0]], ['ArrowRight', [step, 0]], ['ArrowUp', [0, step]], ['ArrowDown', [0, -step]]]);
      const direction = nudges.get(event.key), index = bones.findIndex(bone => bone.name === selected);
      if (!direction || index < 0) return;
      event.preventDefault(); moveJoint(index, direction[0], direction[1]);
    }}
    onPointerDown={event => {
      if (disabled || drag.current || event.button !== 0) return;
      const start = locate(event.currentTarget, event.clientX, event.clientY);
      if (draw) {
        const index = bones.findIndex(bone => bone.name === selected);
        if (index < 0) return;
        drag.current = { kind: 'draw', index, pointer: event.pointerId, start };
        setMovement({ x: 0, y: 0 });
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      let nearest = -1, distance = 12;
      joints.forEach((joint, index) => {
        const position = projected(joint.position, index);
        const gap = Math.hypot(start.x - position.x, start.y - position.y);
        if (gap < distance || (gap === distance && joint.name === selected)) { nearest = index; distance = gap; }
      });
      if (nearest < 0) return;
      const branch = new Set([nearest]);
      joints.forEach((joint, index) => { if (joint.parent !== undefined && branch.has(joint.parent)) branch.add(index); });
      select(joints[nearest].name);
      drag.current = { kind: 'move', index: nearest, pointer: event.pointerId, start, branch };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => {
      if (drag.current?.pointer !== event.pointerId) return;
      const { x, y } = locate(event.currentTarget, event.clientX, event.clientY);
      setMovement({ x: x - drag.current.start.x, y: y - drag.current.start.y });
    }} onPointerUp={event => {
      if (drag.current?.pointer === event.pointerId) {
        const { x, y } = locate(event.currentTarget, event.clientX, event.clientY);
        const dx = x - drag.current.start.x, dy = y - drag.current.start.y;
        if (!disabled) {
          if (drag.current.kind === 'draw' && Math.hypot(dx, dy) > 4) drawBone(drag.current.index, drag.current.start, { x, y });
          else if (drag.current.kind === 'move' && Math.hypot(dx, dy) > 1) moveJoint(drag.current.index, dx / scale, -dy / scale);
        }
      }
      drag.current = null; setMovement(undefined);
    }} onPointerCancel={() => { drag.current = null; setMovement(undefined); }}
    onLostPointerCapture={() => { drag.current = null; setMovement(undefined); }} />;
}
