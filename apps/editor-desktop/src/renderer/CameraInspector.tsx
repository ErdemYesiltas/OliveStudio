import type {Entity, SceneService} from '@rewrite/scene';
import {CameraSchema, cameraType} from '@rewrite/render-pixi';

/** Camera 2D extras: which object it follows, and limits that match the stage in one click. */
export function createCameraInspector(bridge: {scene: SceneService; useEditable(): boolean; stage(): {width: number; height: number}; text(key: string): string; report(error: unknown): void}) {
 const {scene, text} = bridge;
 return function CameraInspector({entity, component}: {entity: Entity; component: Entity['components'][number]}) {
  const editable = bridge.useEditable(), camera = CameraSchema.parse(component.data), entities = scene.document.current.entities, missing = camera.target && !entities.some(e => e.id === camera.target);
  const set = (patch: Record<string, string | number | boolean>) => { try { scene.document.transact('Edit camera', d => { const c = d.entities.find(e => e.id === entity.id)?.components.find(c => c.type === cameraType); if (c) c.data = CameraSchema.parse({...camera, ...patch}); }); } catch (error) { bridge.report(error); } };
  return <div className="camera-inspector" data-testid="camera-inspector">
   <label className="field"><span>{text('camera.target')}</span><select aria-label={text('camera.target')} value={camera.target} disabled={!editable} onChange={e => set({target: e.target.value})}>
    <option value="">{text('camera.noTarget')}</option>{missing && <option value={camera.target}>{text('camera.missingTarget')}</option>}
    {entities.filter(e => e.id !== entity.id).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
   </select></label>
   {camera.limit && <button disabled={!editable} onClick={() => { const s = bridge.stage(); set({limitLeft: 0, limitTop: 0, limitRight: s.width, limitBottom: s.height}); }}>{text('camera.limitsToStage')}</button>}
   <p className="panel-empty">{text(camera.target ? 'camera.helpFollow' : 'camera.help')}</p>
  </div>;
 };
}
