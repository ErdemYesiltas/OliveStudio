import { useEffect, useRef, useState } from 'react';
import { type Skeleton } from '@esotericsoftware/spine-core';
import { Plus, Trash2 } from 'lucide-react';
import { editSpineInfluenceWeight, flipSpineMeshEdge, readSpineMesh, replaceSpineMeshInfluenceBatch, replaceSpineMeshInfluences, spineMeshEdges, splitSpineMeshEdge, splitSpineMeshTriangle, writeSpineMesh, type SpineAttachment, type SpineDocument,
  type SpineInfluence, type SpineMeshGeometry, type SpineMeshPoint, type SpineMeshTarget } from '@olivestudio/engine/spine-format';
import { IconButton } from './chrome';
import { t } from './i18n';
import { validationMessage } from './scene';
import { SpineNumber } from './SpineNumber';
import { spineLocalDelta, spineLocalPoint, spineSetupSkeleton, spineWeightedPoint } from './spinePose';

function bindPoint(skeleton: Skeleton, influences: SpineInfluence[], bone: number) {
  const point = spineWeightedPoint(skeleton, influences);
  const total = influences.reduce((total, influence) => total + influence.weight, 0);
  if (total) point.set(point.x / total, point.y / total);
  const local = spineLocalPoint(skeleton, bone, point);
  return { bone, x: local.x, y: local.y, weight: 0 };
}

function extendInfluences(skeleton: Skeleton, influences: SpineInfluence[], target: number, weight: number) {
  const next = [...influences, bindPoint(skeleton, influences, target)];
  return {
    influences: editSpineInfluenceWeight(next, next.length - 1, weight),
    remap: (offsets: SpineMeshPoint[]) => {
      let x = 0, y = 0, total = 0;
      offsets.forEach((offset, index) => {
        const influence = influences[index], bone = skeleton.bones[influence.bone];
        x += (offset.x * bone.a + offset.y * bone.b) * influence.weight;
        y += (offset.x * bone.c + offset.y * bone.d) * influence.weight;
        total += influence.weight;
      });
      return [...offsets, spineLocalDelta(skeleton, target, total ? x / total : x, total ? y / total : y)];
    },
  };
}

export function SpineMeshFields({ attachment, document, slotBone, meshTarget, disabled, change, changeDocument, report }: {
  attachment: SpineAttachment; document: SpineDocument; slotBone: string; meshTarget: SpineMeshTarget; disabled: boolean;
  change: (attachment: SpineAttachment) => void; report: (error: string) => void;
  changeDocument: (document: SpineDocument) => void;
}) {
  const [vertex, setVertex] = useState(0);
  const [bindBone, selectBone] = useState(-1);
  const [triangle, selectTriangle] = useState(0);
  const [edgeId, selectEdge] = useState(0);
  const [edgePosition, setEdgePosition] = useState(50);
  const [batchVertices, selectBatchVertices] = useState<number[]>([]);
  const [batchBone, selectBatchBone] = useState(0);
  const [batchWeight, setBatchWeight] = useState(0.25);
  const [painting, setPainting] = useState(false);
  const [brushRadius, setBrushRadius] = useState(12);
  let mesh: SpineMeshGeometry;
  try { mesh = readSpineMesh(attachment, document.bones.length); }
  catch (error) { return <small role="alert" className="error">{validationMessage(error)}</small>; }
  const index = Math.min(vertex, mesh.vertices.points.length - 1);
  const update = (next: SpineMeshGeometry) => {
    try { change(writeSpineMesh(attachment, next, document.bones.length)); report(''); }
    catch (error) { report(validationMessage(error)); }
  };
  const setUv = (axis: number, value: number) => update({ ...mesh,
    uvs: mesh.uvs.map((uv, i) => i === index * 2 + axis ? value : uv) });
  const addWeights = () => {
    if (mesh.vertices.weighted) return;
    const bone = document.bones.findIndex(bone => bone.name === slotBone);
    update({ ...mesh, vertices: { weighted: true, points: mesh.vertices.points.map(point => [{ ...point, bone, weight: 1 }]) } });
  };
  const setInfluences = (influences: SpineInfluence[]) => {
    if (!mesh.vertices.weighted) return;
    update({ ...mesh, vertices: { weighted: true, points: mesh.vertices.points.map((point, i) => i === index ? influences : point) } });
  };
  const influences = mesh.vertices.weighted ? mesh.vertices.points[index] : undefined;
  const changeInfluences = (influences: SpineInfluence[], remap: (offsets: SpineMeshPoint[]) => SpineMeshPoint[]) => {
    try { changeDocument(replaceSpineMeshInfluences(document, meshTarget, index, influences, remap)); report(''); }
    catch (error) { report(validationMessage(error)); }
  };
  const available = document.bones.flatMap((bone, i) => influences?.some(influence => influence.bone === i) ? [] : [{ ...bone, index: i }]);
  const target = available.find(bone => bone.index === bindBone) ?? available[0];
  const edges = spineMeshEdges(mesh);
  const edgeIndex = Math.min(edgeId, edges.length - 1);
  const edge = edges[edgeIndex];
  const selection = batchVertices.filter(vertex => vertex < mesh.vertices.points.length);
  const applyWeights = (coverage: ReadonlyMap<number, number>) => {
    if (!mesh.vertices.weighted) return;
    const points = mesh.vertices.points;
    try {
      let skeleton: Skeleton | undefined;
      const patches = [...coverage].flatMap(([vertex, amount]) => {
        const point = points[vertex];
        const existing = point.findIndex(influence => influence.bone === batchBone);
        const before = point[existing]?.weight ?? 0;
        const weight = before + (batchWeight - before) * amount;
        if (weight === before || (existing >= 0 && point.length < 2)) return [];
        if (existing >= 0) return [{ vertex, influences: editSpineInfluenceWeight(point, existing, weight),
          remap: (offsets: SpineMeshPoint[]) => offsets }];
        skeleton ??= spineSetupSkeleton(document.bones);
        return [{ vertex, ...extendInfluences(skeleton, point, batchBone, weight) }];
      });
      if (patches.length) changeDocument(replaceSpineMeshInfluenceBatch(document, meshTarget, patches));
      report('');
    } catch (error) { report(validationMessage(error)); }
  };
  return <>
    <UvCanvas mesh={mesh} index={index} select={setVertex} disabled={disabled} batch={selection}
      brush={painting && mesh.vertices.weighted ? { radius: brushRadius / 100, commit: applyWeights } : undefined}
      toggleBatch={mesh.vertices.weighted ? vertex => selectBatchVertices(vertices => vertices.includes(vertex)
        ? vertices.filter(index => index !== vertex) : [...vertices, vertex]) : undefined}
      move={(u, v) => update({ ...mesh, uvs: mesh.uvs.map((value, i) => i === index * 2 ? u : i === index * 2 + 1 ? v : value) })} />
    <label>{t('spineTriangle')}<select value={triangle} disabled={disabled} onChange={event => selectTriangle(Number(event.currentTarget.value))}>
      {Array.from({ length: mesh.triangles.length / 3 }, (_, i) => <option key={i} value={i}>
        {mesh.triangles.slice(i * 3, i * 3 + 3).map(vertex => vertex + 1).join(' · ')}
      </option>)}
    </select></label>
    <button type="button" className="bundle-command" disabled={disabled} onClick={() => {
      try { changeDocument(splitSpineMeshTriangle(document, meshTarget, triangle)); setVertex(mesh.vertices.points.length); report(''); }
      catch (error) { report(validationMessage(error)); }
    }}><Plus size={15} aria-hidden="true" />{t('spineSplitTriangle')}</button>
    {!!edge && <>
      <label>{t('spineMeshEdge')}<select value={edgeIndex} disabled={disabled}
        onChange={event => selectEdge(Number(event.currentTarget.value))}>
        {edges.map(({ a, b }, i) => <option key={`${a}:${b}`} value={i}>{a + 1} · {b + 1}</option>)}
      </select></label>
      <SpineNumber label={t('spineEdgePosition')} value={edgePosition} min={1} max={99} disabled={disabled} change={setEdgePosition} />
      <button type="button" className="bundle-command" disabled={disabled || edge.faces.length > 2} onClick={() => {
        try {
          const next = splitSpineMeshEdge(document, meshTarget, edge.a, edge.b, edgePosition / 100);
          changeDocument(next.document); setVertex(next.vertex); report('');
        } catch (error) { report(validationMessage(error)); }
      }}>{t('spineSplitEdge')}</button>
      <button type="button" className="bundle-command" disabled={disabled || edge.faces.length !== 2} onClick={() => {
        try { changeDocument(flipSpineMeshEdge(document, meshTarget, edge.a, edge.b)); report(''); }
        catch (error) { report(validationMessage(error)); }
      }}>{t('spineFlipEdge')}</button>
    </>}
    <label>{t('spineVertex')}<select value={index} disabled={disabled} onChange={event => setVertex(Number(event.currentTarget.value))}>
      {mesh.vertices.points.map((_, i) => <option key={i} value={i}>{i + 1}</option>)}
    </select></label>
    <SpineNumber label={t('spineVertexU')} value={mesh.uvs[index * 2]} disabled={disabled} min={0} max={1} change={value => setUv(0, value)} />
    <SpineNumber label={t('spineVertexV')} value={mesh.uvs[index * 2 + 1]} disabled={disabled} min={0} max={1} change={value => setUv(1, value)} />
    {!mesh.vertices.weighted ? <>
      {(['x', 'y'] as const).map(axis => <SpineNumber key={axis} label={t(`spineKey_${axis}`)}
        value={mesh.vertices.weighted ? 0 : mesh.vertices.points[index][axis]} disabled={disabled} change={value => {
          if (!mesh.vertices.weighted) update({ ...mesh, vertices: { weighted: false,
            points: mesh.vertices.points.map((point, i) => i === index ? { ...point, [axis]: value } : point) } });
        }} />)}
      <button className="bundle-command" type="button" disabled={disabled} onClick={addWeights}>{t('spineBindVertices')}</button>
    </> : influences && <>
      {influences.map((influence, i) => <fieldset key={`${index}:${i}`} className="spine-key" disabled={disabled}>
        <legend>{document.bones[influence.bone].name}</legend>
        <SpineNumber label={t('spineWeight')} value={influence.weight} disabled={influences.length === 1} min={0} max={1}
          change={value => setInfluences(editSpineInfluenceWeight(influences, i, value))} />
        {(['x', 'y'] as const).map(axis => <SpineNumber key={axis} label={t(`spineKey_${axis}`)} value={influence[axis]}
          change={value => setInfluences(influences.map((item, k) => k === i ? { ...item, [axis]: value } : item))} />)}
        <IconButton icon={Trash2} label={t('spineRemoveInfluence')} disabled={influences.length < 2} onClick={() => {
          const rest = influences.filter((_, k) => k !== i);
          const total = rest.reduce((total, item) => total + item.weight, 0);
          changeInfluences(rest.map(item => ({ ...item, weight: total ? item.weight / total : 1 / rest.length })),
            offsets => offsets.filter((_, k) => k !== i));
        }} />
      </fieldset>)}
      <label>{t('spineInfluenceBone')}<select value={target?.index ?? -1} disabled={disabled || !target}
        onChange={event => selectBone(Number(event.currentTarget.value))}>
        {!target && <option value={-1}>—</option>}{available.map(bone => <option key={bone.index} value={bone.index}>{bone.name}</option>)}
      </select></label>
      <button className="bundle-command" type="button" disabled={disabled || !target} onClick={() => {
        if (!target) return;
        try {
          const next = extendInfluences(spineSetupSkeleton(document.bones), influences, target.index, 0.25);
          changeInfluences(next.influences, next.remap);
        } catch (error) { report(validationMessage(error)); }
      }}><Plus size={15} aria-hidden="true" />{t('spineAddInfluence')}</button>
      <fieldset className="spine-key" disabled={disabled}>
        <legend>{t('spineBatchWeights')}</legend>
        <label>{t('spineBatchVertices')}<select multiple size={Math.min(6, mesh.vertices.points.length)}
          value={selection.map(String)} onChange={event => selectBatchVertices(
            Array.from(event.currentTarget.selectedOptions, option => Number(option.value)),
          )}>
          {mesh.vertices.points.map((_, vertex) => <option key={vertex} value={vertex}>{vertex + 1}</option>)}
        </select></label>
        <label>{t('spineInfluenceBone')}<select value={batchBone} onChange={event => selectBatchBone(Number(event.currentTarget.value))}>
          {document.bones.map((bone, index) => <option key={bone.name} value={index}>{bone.name}</option>)}
        </select></label>
        <SpineNumber label={t('spineWeight')} value={batchWeight} min={0} max={1} change={setBatchWeight} />
        <button type="button" className="bundle-command" disabled={!selection.length}
          onClick={() => applyWeights(new Map(selection.map(vertex => [vertex, 1])))}>{t('spineApplyBatchWeight')}</button>
        <label>{t('spinePaintWeights')}<input type="checkbox" checked={painting}
          onChange={event => setPainting(event.currentTarget.checked)} /></label>
        {painting && <SpineNumber label={t('spineWeightBrushRadius')} value={brushRadius} min={1} max={100} change={setBrushRadius} />}
      </fieldset>
    </>}
  </>;
}

const size = 200, padding = 12, grid = size - padding * 2;
type UvPoint = { u: number; v: number };
type WeightStroke = { pointer: number; last: UvPoint; weights: Map<number, number> };

function UvCanvas({ mesh, index, select, move, disabled, batch, toggleBatch, brush }: {
  mesh: SpineMeshGeometry; index: number; select: (index: number) => void; move: (u: number, v: number) => void; disabled: boolean;
  batch: number[]; toggleBatch?: (vertex: number) => void;
  brush?: { radius: number; commit: (coverage: ReadonlyMap<number, number>) => void };
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ index: number; pointer: number; moved: boolean }>(null);
  const stroke = useRef<WeightStroke>(null);
  const [brushPoint, setBrushPoint] = useState<UvPoint>();
  const [position, setPosition] = useState<{ u: number; v: number }>();
  const coords = (i: number) => i === index && position ? [position.u, position.v] : [mesh.uvs[i * 2], mesh.uvs[i * 2 + 1]];
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx || !canvas.current) return;
    const style = getComputedStyle(canvas.current);
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = style.getPropertyValue('--line').trim() || '#777';
    ctx.strokeRect(padding, padding, grid, grid);
    ctx.strokeStyle = style.getPropertyValue('--muted').trim() || '#bbb';
    for (let i = 0; i < mesh.triangles.length; i += 3) {
      ctx.beginPath();
      mesh.triangles.slice(i, i + 3).forEach((vertex, j) => {
        const [u, v] = coords(vertex);
        if (!j) ctx.moveTo(padding + u * grid, padding + v * grid);
        else ctx.lineTo(padding + u * grid, padding + v * grid);
      });
      ctx.closePath();
      ctx.stroke();
    }
    for (let i = 0; i < mesh.vertices.points.length; i++) {
      const [u, v] = coords(i);
      ctx.beginPath();
      ctx.fillStyle = style.getPropertyValue(i === index ? '--accent' : '--text').trim() || '#eee';
      ctx.arc(padding + u * grid, padding + v * grid, i === index ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
      if (batch.includes(i)) {
        ctx.beginPath();
        ctx.strokeStyle = style.getPropertyValue('--accent').trim() || '#eee';
        ctx.arc(padding + u * grid, padding + v * grid, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
      const weight = stroke.current?.weights.get(i);
      if (brush && weight) {
        ctx.globalAlpha = 0.35 + 0.65 * weight;
        ctx.fillStyle = style.getPropertyValue('--accent').trim() || '#eee';
        ctx.beginPath();
        ctx.arc(padding + u * grid, padding + v * grid, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    if (brush && brushPoint) {
      ctx.strokeStyle = style.getPropertyValue('--accent').trim() || '#eee';
      ctx.beginPath();
      ctx.arc(padding + brushPoint.u * grid, padding + brushPoint.v * grid, brush.radius * grid, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
  const locate = (element: HTMLCanvasElement, x: number, y: number) => {
    const rect = element.getBoundingClientRect();
    return { u: ((x - rect.left) * size / rect.width - padding) / grid, v: ((y - rect.top) * size / rect.height - padding) / grid };
  };
  const bounded = (u: number, v: number) => ({ u: Math.max(0, Math.min(1, u)), v: Math.max(0, Math.min(1, v)) });
  const collect = (active: WeightStroke, end: UvPoint, radius: number) => {
    const start = active.last;
    const du = end.u - start.u, dv = end.v - start.v;
    const length2 = du * du + dv * dv;
    for (let vertex = 0; vertex < mesh.uvs.length / 2; vertex++) {
      const u = mesh.uvs[vertex * 2] - start.u, v = mesh.uvs[vertex * 2 + 1] - start.v;
      const fraction = length2 ? Math.max(0, Math.min(1, (u * du + v * dv) / length2)) : 0;
      const coverage = 1 - Math.hypot(u - fraction * du, v - fraction * dv) / radius;
      if (coverage > (active.weights.get(vertex) ?? 0)) active.weights.set(vertex, coverage);
    }
    active.last = end;
  };
  const cancel = () => { drag.current = null; stroke.current = null; setPosition(undefined); setBrushPoint(undefined); };
  return <canvas className="spine-uv-canvas" ref={canvas} width={size} height={size} aria-label={t('spineMeshUV')}
    onPointerDown={event => {
      if (disabled || event.button !== 0 || drag.current || stroke.current) return;
      const { u, v } = locate(event.currentTarget, event.clientX, event.clientY);
      if (brush && !event.shiftKey) {
        const point = { u, v };
        const active = { pointer: event.pointerId, last: point, weights: new Map<number, number>() };
        stroke.current = active;
        collect(active, point, brush.radius);
        setBrushPoint(point);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      let closest = -1, distance = 9 / grid;
      for (let i = 0; i < mesh.uvs.length / 2; i++) {
        const next = Math.hypot(mesh.uvs[i * 2] - u, mesh.uvs[i * 2 + 1] - v);
        if (next < distance) { closest = i; distance = next; }
      }
      if (closest < 0) return;
      if (event.shiftKey && toggleBatch) { toggleBatch(closest); return; }
      select(closest);
      drag.current = { index: closest, pointer: event.pointerId, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => {
      if (brush && !disabled && !drag.current) {
        if (stroke.current && stroke.current.pointer !== event.pointerId) return;
        const point = locate(event.currentTarget, event.clientX, event.clientY);
        if (stroke.current?.pointer === event.pointerId) collect(stroke.current, point, brush.radius);
        setBrushPoint(point);
        return;
      }
      if (drag.current?.pointer !== event.pointerId) return;
      const { u, v } = locate(event.currentTarget, event.clientX, event.clientY);
      drag.current.moved = true;
      setPosition(bounded(u, v));
    }} onPointerUp={event => {
      if (stroke.current?.pointer !== event.pointerId && drag.current?.pointer !== event.pointerId) return;
      if (brush && !disabled && stroke.current?.pointer === event.pointerId) {
        const active = stroke.current;
        collect(active, locate(event.currentTarget, event.clientX, event.clientY), brush.radius);
        cancel();
        if (active.weights.size) brush.commit(active.weights);
        return;
      }
      if (drag.current?.pointer === event.pointerId && drag.current.index === index && drag.current.moved) {
        const { u, v } = locate(event.currentTarget, event.clientX, event.clientY);
        const end = bounded(u, v);
        move(end.u, end.v);
      }
      cancel();
    }} onPointerLeave={() => { if (!stroke.current) setBrushPoint(undefined); }}
    onPointerCancel={event => { if (stroke.current?.pointer === event.pointerId || drag.current?.pointer === event.pointerId) cancel(); }}
    onLostPointerCapture={event => { if (stroke.current?.pointer === event.pointerId || drag.current?.pointer === event.pointerId) cancel(); }} />;
}
