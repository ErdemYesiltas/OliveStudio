import type {Cue} from '@rewrite/animation';
import type {ActionDefinition, InteractionCatalog} from '@rewrite/interactions';
import {ActionValueEditor} from '@rewrite/interactions/views';

/** Cutscene cue on a timeline marker: any rule action, its target and its values (same editors as the Rules inspector). */
export function createCueEditor(bridge: {actions(): readonly ActionDefinition[]; catalog(): InteractionCatalog; text(key: string): string}) {
 const t = bridge.text;
 return function CueEditor({cue, disabled, set}: {cue?: Cue; disabled: boolean; set(cue: Cue | undefined): void}) {
  const defs = bridge.actions(), catalog = bridge.catalog(), def = cue && defs.find(d => d.type === cue.type), refs = def ? def.references(catalog) : [];
  return <div className="cue-editor" data-testid="cue-editor">
   <label className="field"><span>{t('animation.cue')}</span><select aria-label={t('animation.cue')} value={cue?.type ?? ''} disabled={disabled} onChange={e => {
    const next = defs.find(d => d.type === e.target.value);
    if (!next) { set(undefined); return; }
    set({id: cue?.id ?? crypto.randomUUID(), type: next.type, targetId: next.references(catalog)[0]?.id ?? '', value: true});
   }}>
    <option value="">{t('animation.noCue')}</option>
    {cue && !def && <option value={cue.type}>{t('animation.missingCue')}</option>}
    {defs.map(d => <option key={d.type} value={d.type}>{t(d.titleKey)}</option>)}
   </select></label>
   {cue && def && <label className="field"><span>{t('animation.cueTarget')}</span><select aria-label={t('animation.cueTarget')} value={cue.targetId} disabled={disabled} onChange={e => set({...cue, targetId: e.target.value})}>
    {!refs.some(r => r.id === cue.targetId) && <option value={cue.targetId}>{t('animation.missingTarget')}</option>}
    {refs.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
   </select></label>}
   {cue && def && <ActionValueEditor action={cue as never} globals={catalog.globals ?? []} entities={catalog.entities} label="cue" disabled={disabled} t={t} edit={fn => { const next = structuredClone(cue); (fn as (a: Cue) => void)(next); set(next); }}/>}
  </div>;
 };
}
