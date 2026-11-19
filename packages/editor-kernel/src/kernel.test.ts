import { describe, expect, it } from 'vitest';
import { ModuleHost } from './index';
import { commands, token, type EditorModule } from '@rewrite/sdk';
const module = (id: string, activate: EditorModule['activate'], requires = {}): EditorModule => ({ manifest: { id, version: '1.0.0', apiVersion: 1, requires }, activate });

describe('module host', () => {
  it('activates in dependency order, exposes declared services, executes contributed commands and reverses cleanup once', async () => {
    const log: string[] = [], service = token<number>('base', 'base.number');
    const host = new ModuleHost();
    await host.start([
      module('feature', c => { expect(c.get(service)).toBe(42); log.push('feature'); c.contribute(commands, 'feature.run', { titleKey: 'run', execute: () => 42 }); return () => { log.push('-feature'); }; }, { base: '^1.0.0' }),
      module('base', c => { log.push('base'); c.provide(service, 42); c.own(() => { log.push('-base'); }); }),
    ]);
    expect(await host.execute('feature.run')).toBe(42);
    await Promise.all([host.stop(), host.stop()]);
    expect(log).toEqual(['base','feature','-feature','-base']);
    expect(host.entries(commands)).toEqual([]);
    await expect(host.execute('feature.run')).rejects.toThrow('not ready');
  });
  it.each(['missing','cycle','version','duplicate'])('rejects %s graph before side effects', async kind => {
    let calls = 0;
    const a = module('a', () => { calls++; }, kind === 'cycle' ? { b: '*' } : { missing: '^2' });
    const b = module('b', () => { calls++; }, { a: '*' });
    const input = kind === 'cycle' ? [a,b] : kind === 'version' ? [a,module('missing', () => { calls++; })] : kind === 'duplicate' ? [a,a] : [a];
    await expect(new ModuleHost().start(input)).rejects.toThrow(); expect(calls).toBe(0);
  });
  it('rolls back async activation including subscriptions; blocks dependents but keeps independent features', async () => {
    let disposed = 0;
    const host = new ModuleHost();
    await host.start([
      module('bad', async c => { c.own(() => { disposed++; }); c.contribute(commands, 'bad.run', { titleKey: 'bad', execute: () => 0 }); await Promise.resolve(); throw new Error('failed'); }),
      module('child', () => { throw new Error('must not activate'); }, { bad: '*' }),
      module('independent', c => { c.contribute(commands, 'independent.run', { titleKey: 'ok', execute: () => 'ok' }); }),
    ]);
    expect(disposed).toBe(1); expect(host.states.get('child')).toBe('blocked');
    expect(host.entries(commands).map(e => e.id)).toEqual(['independent.run']);
    expect(await host.execute('independent.run')).toBe('ok'); await host.stop();
  });
  it('prevents undeclared service access and duplicate staged contributions', async () => {
    const key = token<number>('base', 'base.value'), host = new ModuleHost();
    await host.start([module('base', c => c.provide(key, 1)), module('spy', c => { c.get(key); }), module('duplicate', c => {
      const command = { titleKey: 'test', execute: () => 1 };
      c.contribute(commands, 'duplicate.run', command); c.contribute(commands, 'duplicate.run', command);
    })]);
    expect(host.states.get('spy')).toBe('failed'); expect(host.states.get('duplicate')).toBe('failed');
    expect(host.entries(commands)).toEqual([]); await host.stop();
  });
  it('continues shutdown after a cleanup failure', async () => {
    let clean = false; const host = new ModuleHost();
    await host.start([module('base', c => { c.own(() => { clean = true; }); c.own(() => { throw Error('cleanup'); }); })]);
    await host.stop(); expect(clean).toBe(true); expect(host.diagnostics[0].message).toContain('cleanup');
  });
});
it('aborts an in-flight activation and never publishes its staged registrations',async()=>{
 const host=new ModuleHost();let disposed=0;
 const boot=host.start([module('slow',async c=>{
  c.own(()=>{disposed++;});c.contribute(commands,'slow.run',{titleKey:'slow',execute:()=>1});
  await new Promise<void>((_resolve,reject)=>c.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));
 })]);
 await host.stop();await boot;expect(disposed).toBe(1);expect(host.entries(commands)).toEqual([]);
});

it('exposes actual active module versions as an isolated snapshot for project/export locks',async()=>{const host=new ModuleHost();await host.start([{manifest:{id:'versioned',version:'2.3.4',apiVersion:1},activate(){}},{manifest:{id:'failed',version:'3.0.0',apiVersion:1},activate(){throw Error('fail');}}]);expect(host.versions.get('versioned')).toBe('2.3.4');expect(host.versions.has('failed')).toBe(false);(host.versions as Map<string,string>).set('versioned','mutated');expect(host.versions.get('versioned')).toBe('2.3.4');await host.stop();expect(host.versions.size).toBe(0);});
