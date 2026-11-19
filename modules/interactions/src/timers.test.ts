import {expect, it} from 'vitest';
import {makeEntity, type Entity} from '@rewrite/scene';
import {TimerSession, timerType} from './timers';

const timer = (entity: Entity, id: string, data: Record<string, unknown>) => { entity.components.push({id, type: timerType, version: 1, data: {seconds: 1, repeat: false, autostart: true, ...data}}); return entity; };
const run = (session: TimerSession, seconds: number) => { for (let i = 0; i < Math.round(seconds * 60); i++) session.system.fixedUpdate!(1 / 60); };

it('fires once after its seconds, repeats when asked, starts only when told and pauses with an inactive object', () => {
 const a = timer(makeEntity('A'), 'once', {seconds: .5}), b = timer(makeEntity('B'), 'loop', {seconds: .25, repeat: true}), c = timer(makeEntity('C'), 'manual', {seconds: .2, autostart: false});
 const entities = [a, b, c], fired: string[] = [];
 const session = new TimerSession(() => entities, (id, silent) => fired.push(`${id}${silent ? ' (silent)' : ''}`));
 session.system.start!();
 run(session, .49); expect(fired.filter(f => f === 'once')).toEqual([]);
 run(session, .02); expect(fired.filter(f => f === 'once')).toEqual(['once']);
 run(session, 1); expect(fired.filter(f => f === 'once')).toHaveLength(1);
 expect(fired.filter(f => f === 'loop')).toHaveLength(6);
 expect(fired).not.toContain('manual');
 session.play('manual'); run(session, .2); expect(fired.filter(f => f === 'manual')).toHaveLength(1);
 b.active = false; const loops = fired.filter(f => f === 'loop').length; run(session, 1); expect(fired.filter(f => f === 'loop')).toHaveLength(loops);
 b.active = true; session.stop('loop'); run(session, 1); expect(fired.filter(f => f === 'loop')).toHaveLength(loops);
 expect(session.diagnostics).toMatchObject({once: {running: false}, loop: {running: false}, manual: {running: false}});
});

it('picks up timers of spawned objects and forgets removed ones; Step fires silently', () => {
 const entities: Entity[] = [], fired: string[] = [];
 let silent = false;
 const session = new TimerSession(() => entities, (id, s) => fired.push(`${id}${s ? ' (silent)' : ''}`), () => silent);
 session.system.start!();
 entities.push(timer(makeEntity('Copy'), 'copy-timer', {seconds: .1}));
 session.system.spawned!([entities[0].id]);
 silent = true; run(session, .1);
 expect(fired).toEqual(['copy-timer (silent)']);
 entities.splice(0); session.system.removed!(['x']);
 expect(session.diagnostics).toEqual({});
});
