import { useEffect, useMemo, useRef, useState } from 'react';
import { Vector2 } from '@esotericsoftware/spine-core';
import { Plus, Trash2 } from 'lucide-react';
import { packSpineDeform, replaceSpineDeformKeys, resolveSpineMesh, spineDeformKeys, spineDeformPointLayout, spineMeshTargets, unpackSpineDeform,
  type SpineDeformKey, type SpineDocument, type SpineMeshPoint } from '@olivestudio/engine/spine-format';
import { IconButton } from './chrome';
import { t } from './i18n';
import { validationMessage } from './scene';
import { SpineNumber } from './SpineNumber';
import { SpineCurveFields } from './SpineCurveFields';
import { spineLocalDelta, spineSetupSkeleton, spineWeightedPoint } from './spinePose';

export type SpineDeformSelection = { skin: string; time: number };
const offsetLabels = ['spineKey_x', 'spineKey_y'] as const;

export function SpineDeformFields({ document, animation, disabled, selectAnimation, change, report, onSelection }: {
  document: SpineDocument; animation: string; disabled: boolean; selectAnimation: (name: string) => void;
  change: (document: SpineDocument) => void; report: (error: string) => void; onSelection: (selection: SpineDeformSelection) => void;
}) {
  const [meshIndex, selectMesh] = useState(0);
  const [frame, selectFrame] = useState(0);
  const [vertex, selectVertex] = useState(0);
  const result = useMemo(() => {
    try {
      const targets = spineMeshTargets(document).filter(item => !item.attachment.parent || item.attachment.timelines === false);
      const target = targets[meshIndex] ?? targets[0];
      if (!target) return { targets };
      const { mesh } = resolveSpineMesh(document, target);
      const keys = spineDeformKeys(document, animation, target);
      const layout = spineDeformPointLayout(mesh);
      const skeleton = spineSetupSkeleton(document.bones);
      const slotBone = document.slots?.find(slot => slot.name === target.slot)?.bone;
      const bone = document.bones.findIndex(bone => bone.name === slotBone);
      if (bone < 0) throw new Error(t('spineDeformNoMesh'));
      return { targets, target, mesh, keys, layout, skeleton, bone };
    } catch (failure) { return { targets: [], error: validationMessage(failure) }; }
  }, [document, animation, meshIndex]);
  const { targets, target, mesh, keys, layout, skeleton, bone, error } = result;
  const current = Math.min(frame, (keys?.length ?? 1) - 1);
  const key = keys?.[current];
  const time = key?.time ?? 0;
  useEffect(() => { if (target) onSelection({ skin: target.skin, time }); }, [target?.skin, time, onSelection]);

  let editor = null;
  if (target && mesh && keys && layout && skeleton && bone !== undefined) {
    try {
      const selected = Math.min(vertex, mesh.vertices.points.length - 1);
      const offsets = unpackSpineDeform(key ?? {}, layout.length);
      const { start, count } = layout.points[selected];
      const vertices = mesh.vertices;
      const project = (values?: number[]) => layout.points.map(({ start }, index) => vertices.weighted
        ? spineWeightedPoint(skeleton, vertices.points[index].map((point, i) => ({
          ...point, x: point.x + (values?.[start + 2 * i] ?? 0), y: point.y + (values?.[start + 2 * i + 1] ?? 0),
        })))
        : skeleton.bones[bone].localToWorld(new Vector2(vertices.points[index].x + (values?.[start] ?? 0),
          vertices.points[index].y + (values?.[start + 1] ?? 0))));
      const apply = (next: SpineDeformKey[]) => {
        try { change(replaceSpineDeformKeys(document, animation, target, next)); report(''); return true; }
        catch (failure) { report(validationMessage(failure)); return false; }
      };
      const patch = (patch: SpineDeformKey) => apply(keys.map((item, i) => i === current ? patch : item));
      const changeOffsets = (values: number[]) => { if (key) patch(packSpineDeform(key, values)); };
      const move = (index: number, dx: number, dy: number) => {
        if (!key) return;
        try {
          const bones = vertices.weighted ? vertices.points[index].map(point => point.bone) : [bone];
          const total = vertices.weighted ? vertices.points[index].reduce((total, point) => total + point.weight, 0) : 1;
          if (!total) return;
          const next = [...offsets], start = layout.points[index].start;
          bones.forEach((bone, i) => {
            const moved = spineLocalDelta(skeleton, bone, dx / total, dy / total);
            next[start + i * 2] += moved.x;
            next[start + i * 2 + 1] += moved.y;
          });
          changeOffsets(next);
        } catch (failure) { report(validationMessage(failure)); }
      };
      const nextTime = keys[current + 1]?.time;
      editor = <>
        <button type="button" className="bundle-command" disabled={disabled || !animation} onClick={() => {
          const time = keys.length ? Math.round(((keys.at(-1)?.time ?? 0) + .25) * 1000) / 1000 : 0;
          if (apply([...keys, { time }])) selectFrame(keys.length);
        }}><Plus size={15} aria-hidden="true" />{t('spineAddDeformKey')}</button>
        <label>{t('spineDeformKey')}<select value={key ? current : -1} disabled={disabled || !key}
          onChange={event => selectFrame(Number(event.currentTarget.value))}>
          {!key && <option value={-1}>—</option>}
          {keys.map((key, index) => <option key={index} value={index}>{key.time ?? 0} s</option>)}
        </select></label>
        <DeformCanvas base={project()} points={project(offsets)} triangles={mesh.triangles} selected={selected}
          select={selectVertex} move={move} disabled={disabled || !key} />
        {key && <>
          <SpineNumber label={t('spinePreviewTime')} value={time} disabled={disabled} min={0} change={time => {
            if (patch({ ...key, time })) selectFrame(keys.filter((other, index) => index !== current && (other.time ?? 0) < time).length);
          }} />
          <SpineCurveFields curve={key.curve} start={time} end={nextTime} disabled={disabled}
            components={[{ label: t('spineSection_deform'), from: 0, to: 1 }]}
            change={curve => {
              const { curve: _previous, ...rest } = key;
              patch(curve === undefined ? rest : { ...rest, curve });
            }} />
          <label>{t('spineVertex')}<select value={selected} disabled={disabled} onChange={event => selectVertex(Number(event.currentTarget.value))}>
            {layout.points.map((_, index) => <option key={index} value={index}>{index + 1}</option>)}
          </select></label>
          {Array.from({ length: count }, (_, i) => <fieldset key={`${selected}:${i}`} className="spine-key" disabled={disabled}>
            <legend>{vertices.weighted ? document.bones[vertices.points[selected][i].bone].name : t('spineDeformOffsets')}</legend>
            {offsetLabels.map((label, axis) => {
              const index = start + i * 2 + axis;
              return <SpineNumber key={axis} label={t(label)} value={offsets[index]} change={value =>
                changeOffsets(offsets.map((offset, i) => i === index ? value : offset))} />;
            })}
          </fieldset>)}
          <IconButton icon={Trash2} label={t('spineRemoveKey')} disabled={disabled} onClick={() => {
            if (apply(keys.filter((_, i) => i !== current))) selectFrame(Math.max(0, current - 1));
          }} />
        </>}
      </>;
    } catch (failure) { editor = <small className="error" role="alert">{validationMessage(failure)}</small>; }
  }
  return <>
    <label>{t('assetAnimation')}<select value={animation} disabled={disabled || !animation} onChange={event => {
      selectAnimation(event.currentTarget.value); selectFrame(0);
    }}>
      {!animation && <option value="">—</option>}
      {Object.keys(document.animations ?? {}).map(animation => <option key={animation}>{animation}</option>)}
    </select></label>
    <label>{t('spineDeformMesh')}<select value={target ? targets.indexOf(target) : -1} disabled={disabled || !target}
      onChange={event => { selectMesh(Number(event.currentTarget.value)); selectFrame(0); selectVertex(0); }}>
      {!target && <option value={-1}>—</option>}
      {targets.map(({ skin, slot, name }, index) => <option key={JSON.stringify([skin, slot, name])} value={index}>{skin} / {slot} / {name}</option>)}
    </select></label>
    {error ? <small className="error" role="alert">{error}</small> : !target ? <small>{t('spineDeformNoMesh')}</small> : editor}
  </>;
}

const width = 280, height = 220;
function DeformCanvas({ base, points, triangles, selected, select, move, disabled }: {
  base: SpineMeshPoint[]; points: SpineMeshPoint[]; triangles: number[]; selected: number;
  select: (index: number) => void; move: (index: number, dx: number, dy: number) => void; disabled: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ index: number; id: number; x: number; y: number }>(null);
  const [delta, setDelta] = useState<SpineMeshPoint>();
  const bounds = base.reduce((b, p) => ({
    left: Math.min(b.left, p.x), right: Math.max(b.right, p.x), top: Math.max(b.top, p.y), bottom: Math.min(b.bottom, p.y),
  }), { left: Infinity, right: -Infinity, top: -Infinity, bottom: Infinity });
  const scale = Math.min((width - 48) / Math.max(1, bounds.right - bounds.left), (height - 48) / Math.max(1, bounds.top - bounds.bottom));
  const screen = ({ x, y }: SpineMeshPoint) => ({
    x: width / 2 + (x - (bounds.left + bounds.right) / 2) * scale,
    y: height / 2 - (y - (bounds.top + bounds.bottom) / 2) * scale,
  });
  const display = points.map((point, index) => {
    const mapped = screen(point);
    return index === selected && delta ? { x: mapped.x + delta.x, y: mapped.y + delta.y } : mapped;
  });
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx || !canvas.current) return;
    const style = getComputedStyle(canvas.current);
    ctx.clearRect(0, 0, width, height);
    for (const [vertices, dashed] of [[base.map(screen), true], [display, false]] as const) {
      ctx.strokeStyle = style.getPropertyValue(dashed ? '--muted' : '--accent').trim() || '#bbb';
      ctx.setLineDash(dashed ? [3, 4] : []);
      for (let i = 0; i < triangles.length; i += 3) {
        ctx.beginPath();
        for (let j = 0; j < 3; j++) {
          const { x, y } = vertices[triangles[i + j]];
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.stroke();
      }
    }
    display.forEach(({ x, y }, index) => {
      ctx.fillStyle = style.getPropertyValue(index === selected ? '--accent' : '--text').trim() || '#fff';
      ctx.beginPath(); ctx.arc(x, y, index === selected ? 6 : 4, 0, Math.PI * 2); ctx.fill();
    });
  });
  const location = (canvas: HTMLCanvasElement, x: number, y: number) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (x - rect.left) * width / rect.width, y: (y - rect.top) * height / rect.height };
  };
  return <canvas className="spine-uv-canvas" aria-label={t('spineDeformCanvas')} ref={canvas} width={width} height={height}
    onPointerDown={event => {
      if (disabled || event.button !== 0) return;
      const { x, y } = location(event.currentTarget, event.clientX, event.clientY);
      let closest = -1, distance = 12;
      display.forEach((point, index) => {
        const gap = Math.hypot(x - point.x, y - point.y);
        if (gap < distance) { closest = index; distance = gap; }
      });
      if (closest < 0) return;
      select(closest);
      drag.current = { index: closest, id: event.pointerId, x, y };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => {
      if (drag.current?.id !== event.pointerId) return;
      const { x, y } = location(event.currentTarget, event.clientX, event.clientY);
      setDelta({ x: x - drag.current.x, y: y - drag.current.y });
    }} onPointerUp={event => {
      if (drag.current?.id === event.pointerId) {
        const { x, y } = location(event.currentTarget, event.clientX, event.clientY);
        const dx = x - drag.current.x, dy = y - drag.current.y;
        if (Math.hypot(dx, dy) > 1) move(drag.current.index, dx / scale, -dy / scale);
      }
      drag.current = null; setDelta(undefined);
    }} onLostPointerCapture={() => { drag.current = null; setDelta(undefined); }} />;
}
