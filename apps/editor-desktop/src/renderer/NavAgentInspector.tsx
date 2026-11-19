import type {Json} from '@rewrite/sdk';
import type {Entity, SceneService} from '@rewrite/scene';
import {NavAgentSchema, navAgentType, navGridType} from '@rewrite/navigation';

/** Nav Agent extras: the object it chases, and a hint when the scene has no Nav Grid. */
export function createNavAgentInspector(bridge: {scene: SceneService; useEditable(): boolean; text(key: string): string; report(error: unknown): void}) {
 const {scene, text} = bridge;
 return function NavAgentInspector({entity, component}: {entity: Entity; component: Entity['components'][number]}) {
  const editable = bridge.useEditable(), agent = NavAgentSchema.parse(component.data), entities = scene.document.current.entities, missing = agent.follow && !entities.some(e => e.id === agent.follow);
  const grid = entities.some(e => e.components.some(c => c.type === navGridType));
  const set = (follow: string) => { try { scene.document.transact('Edit Nav Agent', d => { const c = d.entities.find(e => e.id === entity.id)?.components.find(c => c.type === navAgentType); if (c) c.data = NavAgentSchema.parse({...agent, follow}) as unknown as Json; }); } catch (error) { bridge.report(error); } };
  return <div className="nav-agent-inspector" data-testid="nav-agent-inspector">
   <label className="field"><span>{text('nav.follow')}</span><select aria-label={text('nav.follow')} value={agent.follow} disabled={!editable} onChange={e => set(e.target.value)}>
    <option value="">{text('nav.noFollow')}</option>{missing && <option value={agent.follow}>{text('nav.missingFollow')}</option>}
    {entities.filter(e => e.id !== entity.id).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
   </select></label>
   <p className={grid ? 'panel-empty' : 'component-warning'}>{text(grid ? 'nav.agentHelp' : 'nav.noGrid')}</p>
  </div>;
 };
}
