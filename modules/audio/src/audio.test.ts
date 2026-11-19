import {expect,it} from 'vitest';
import {makeEntity,type Entity} from '@rewrite/scene';
import {AudioSession,AudioPreview,AudioSourceSchema,type AudioVoice,type VoiceSnapshot,type AudioProvider} from './index';
class Voice implements AudioVoice {
 snapshot:VoiceSnapshot={state:'ready',starts:0};disposed=false;listeners=new Set<()=>void>();
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 emit(state:VoiceSnapshot['state']){this.snapshot={...this.snapshot,state};for(const fn of this.listeners)fn();}
 play(){this.snapshot={state:'playing',starts:this.snapshot.starts+1};this.emit('playing');}pause(){if(this.snapshot.state==='playing')this.emit('paused');}stop(){this.emit('stopped');}dispose(){this.disposed=true;this.listeners.clear();}
}
function fixture(){const voices:Voice[]=[],provider:AudioProvider={id:'test',supports:()=>true,create:()=>{const voice=new Voice();voices.push(voice);return voice;}},entity=(id:string,autoplay=true)=>{const e=makeEntity(id);e.id=id;e.components.push({id:`audio-${id}`,type:'audio.source',version:1,data:{assetId:'',volume:1,rate:1,loop:false,autoplay}});return e;};let entities:Entity[]=[entity('a'),entity('b')];const session=new AudioSession(()=>entities,()=>({url:'shared.wav',format:'wav',volume:1,loop:false,rate:1}),provider);return{session,voices,provider,entity,replace:(next:Entity[])=>{entities=next;},get entities(){return entities;}};}
it('validates provider-neutral source settings',()=>{expect(()=>AudioSourceSchema.parse({assetId:'',volume:2,rate:1,loop:false,autoplay:false})).toThrow();});
it('owns one independent voice per source and Stop is source-local',()=>{const f=fixture();f.session.system.start!();expect(f.voices).toHaveLength(2);f.session.stop('audio-a');expect(f.voices.map(v=>v.snapshot.state)).toEqual(['stopped','playing']);f.session.dispose();expect(f.voices.every(v=>v.disposed)).toBe(true);});
it('pauses/resumes only intended sources; Step reconciliation never starts audio',()=>{const f=fixture();f.session.system.start!();f.session.stop('audio-b');f.session.pause();expect(f.voices[0].snapshot.state).toBe('paused');f.replace([...f.entities,f.entity('c')]);f.session.system.update!(1/60);expect(f.voices[2].snapshot.starts).toBe(0);f.session.play('audio-b');expect(f.voices[1].snapshot.starts).toBe(1);f.session.resume();expect(f.voices.map(v=>v.snapshot.starts)).toEqual([2,2,1]);});
it('does not replay a naturally completed source after resume',()=>{const f=fixture();f.session.system.start!();f.voices[0].emit('ended');f.session.pause();f.session.resume();expect(f.voices[0].snapshot.starts).toBe(1);});
it('releases inactive descendants and recreates them only when active again',()=>{const f=fixture();f.entities[1].parentId='a';f.session.system.start!();f.entities[0].active=false;f.session.system.update!(.1);expect(f.voices.every(v=>v.disposed)).toBe(true);expect(f.session.diagnostics).toEqual({});f.entities[0].active=true;f.session.system.update!(.1);expect(f.voices).toHaveLength(4);});
it('contains missing clip errors to the affected source and retries changed data',()=>{const f=fixture();let bad=true;const session=new AudioSession(()=>f.entities,s=>{if(bad&&s.volume===1)throw Error('Missing clip');return{url:'a',format:'wav',volume:s.volume,loop:false,rate:1};},f.provider);session.system.start!();expect(Object.values(session.diagnostics).every(e=>e.state==='error')).toBe(true);bad=false;session.system.update!(.1);expect(f.voices).toHaveLength(2);});
it('releases source subscriptions and ignores updates/play after disposal',()=>{const f=fixture();f.session.system.start!();f.session.dispose();expect(f.voices.every(v=>v.listeners.size===0)).toBe(true);f.session.system.update!(1);f.session.play('audio-a');expect(f.voices).toHaveLength(2);});
it('keeps editor previews independent and disposes repeated previews and Stop All',()=>{const f=fixture(),preview=new AudioPreview(()=>f.provider),spec={url:'a',format:'wav'as const,volume:1,loop:false,rate:1};preview.play('a',spec);preview.play('b',spec);preview.play('a',spec);expect(f.voices[0].disposed).toBe(true);expect(f.voices[1].disposed).toBe(false);preview.stopAll();expect(preview.diagnostics).toEqual({});expect(f.voices.every(v=>v.disposed)).toBe(true);});
it('mixes source volume through its bus and the master gain; older sources use the effects bus', async () => {
 const {busGain, defaultMixer, AudioSourceSchema} = await import('./contracts');
 const mixer = {...defaultMixer, master: 0.5, music: 0.4, sfx: 0.8};
 expect(busGain(mixer, 'music')).toBeCloseTo(0.2);
 expect(busGain(undefined, 'music')).toBe(1);
 expect(AudioSourceSchema.parse({assetId: '', volume: 1, loop: false, rate: 1, autoplay: false}).bus).toBe('sfx');
});

it('spatial mix: full volume inside min distance, rolloff out to max, panned by side; listener objects and world points', async () => {
 const {spatialMix, worldPoint, listenerPoint, audioRanges, AudioSourceSchema} = await import('./index');
 const source = AudioSourceSchema.parse({assetId: '', volume: 1, loop: false, rate: 1, autoplay: false, spatial: true, minDistance: 100, maxDistance: 1100});
 const ear = {x: 0, y: 0};
 expect(spatialMix(source, {x: 50, y: 0}, ear)).toEqual({gain: 1, pan: expect.closeTo(50 / 550, 6)});
 expect(spatialMix(source, {x: 0, y: 600}, ear)).toEqual({gain: 0.5, pan: 0});
 expect(spatialMix(source, {x: -2000, y: 0}, ear)).toEqual({gain: 0, pan: -1});
 expect(spatialMix({...source, rolloff: 'inverse'}, {x: 0, y: 400}, ear).gain).toBeCloseTo(0.25);
 expect(spatialMix({...source, rolloff: 'exponential'}, {x: 0, y: 200}, ear).gain).toBeCloseTo(0.25);
 expect(spatialMix({...source, rolloff: 'inverse'}, {x: 0, y: 5000}, ear).gain).toBeCloseTo(100 / 1100);
 expect(spatialMix({...source, panAmount: 0}, {x: 500, y: 0}, ear).pan).toBe(0);
 expect(spatialMix({...source, spatial: false, pan: -0.4}, {x: 9999, y: 0}, ear)).toEqual({gain: 1, pan: -0.4});
 const t = (x: number, y: number, rotation = 0, scale = 1) => ({id: `t${x}`, type: 'scene.transform2d', version: 1, data: {x, y, rotation, scaleX: scale, scaleY: scale}});
 const entities = [
  {id: 'parent', name: 'P', parentId: null, active: true, components: [t(100, 100, 90, 2)]},
  {id: 'child', name: 'C', parentId: 'parent', active: true, components: [t(10, 0), {id: 's', type: 'audio.source', version: 1, data: source}]},
  {id: 'ears', name: 'E', parentId: null, active: false, components: [t(5, 5), {id: 'l', type: 'audio.listener', version: 1, data: {}}]},
 ] as never;
 const p = worldPoint(entities, 'child')!;
 expect(p.x).toBeCloseTo(100); expect(p.y).toBeCloseTo(120);
 expect(listenerPoint(entities)).toBeUndefined();
 (entities as {active: boolean}[])[2].active = true;
 expect(listenerPoint(entities)).toEqual({x: 5, y: 5});
 const rings = audioRanges(entities, ['child']);
 expect(rings).toHaveLength(2); expect(Math.hypot(rings[1].points[0].x, rings[1].points[0].y)).toBeCloseTo(1100 / 2);
});
