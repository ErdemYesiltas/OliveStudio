import {afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({instances:[]as {options:Record<string,unknown>;loaded:boolean;play:ReturnType<typeof vi.fn>;pause:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>;off:ReturnType<typeof vi.fn>;unload:ReturnType<typeof vi.fn>}[]}));
vi.mock('howler',()=>({Howler:{codecs:()=>true},Howl:class{loaded=false;play=vi.fn(()=>42);pause=vi.fn();stop=vi.fn();off=vi.fn();unload=vi.fn();playing=()=>false;state=()=>this.loaded?'loaded':'loading';load(){}constructor(public options:Record<string,unknown>){mocks.instances.push(this);}}}));
import {howlerProvider,howlerModule} from './index';
import {ModuleHost} from '@rewrite/kernel';
import {audioProviders} from '@rewrite/audio/contracts';
import {providers} from '@rewrite/sdk';
const spec={url:'https://example.test/audio.wav',format:'wav'as const,volume:.3,rate:1.5,loop:true};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();mocks.instances.splice(0);});
function callback(index:number,key:string,...args:unknown[]){(mocks.instances[index].options[key]as(...args:unknown[])=>void)(...(['onplay','onend'].includes(key)&&!args.length?[42]:args));}
it('uses independently owned URLs/Howls and applies volume/rate/loop without affecting another source',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([1,2,3]))));const a=howlerProvider.create(spec),b=howlerProvider.create(spec);a.play();b.play();await vi.waitFor(()=>expect(mocks.instances).toHaveLength(2));
 expect(mocks.instances[0].options).toMatchObject({volume:.3,rate:1.5,loop:true,html5:false});expect(mocks.instances[0].options.src).not.toEqual(mocks.instances[1].options.src);
 for(let i=0;i<2;i++){mocks.instances[i].loaded=true;callback(i,'onload');callback(i,'onplay');}expect(a.snapshot.state).toBe('playing');a.stop();expect(mocks.instances[0].stop).toHaveBeenCalledWith(42);expect(mocks.instances[1].stop).not.toHaveBeenCalled();a.dispose();b.dispose();expect(mocks.instances.every(i=>i.unload.mock.calls.length===1)).toBe(true);
});
it('does not play on a late load after pause or stop, and resumes the retained sound ID',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([1]))));const a=howlerProvider.create(spec);a.play();a.pause();await vi.waitFor(()=>expect(mocks.instances).toHaveLength(1));mocks.instances[0].loaded=true;callback(0,'onload');expect(mocks.instances[0].play).not.toHaveBeenCalled();a.play();callback(0,'onplay');a.pause();a.play();expect(mocks.instances[0].play).toHaveBeenLastCalledWith(42);a.stop();callback(0,'onload');expect(a.snapshot.state).toBe('ready');a.dispose();
});
it('aborts fetches and ignores callbacks after disposal',async()=>{
 let resolve!:(value:Response)=>void,signal:AbortSignal|undefined;vi.stubGlobal('fetch',vi.fn((_url,init)=>{signal=init.signal;return new Promise(r=>{resolve=r;});}));const a=howlerProvider.create(spec);a.play();a.dispose();expect(signal?.aborted).toBe(true);resolve(new Response(new Uint8Array([1])));await new Promise(r=>setTimeout(r,0));expect(mocks.instances).toHaveLength(0);
});
it('contains load errors to the affected voice and revokes its owned URL on disposal',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([1]))));const revoke=vi.spyOn(URL,'revokeObjectURL'),a=howlerProvider.create(spec),b=howlerProvider.create(spec);await vi.waitFor(()=>expect(mocks.instances).toHaveLength(2));callback(0,'onloaderror',1,'bad decode');expect(a.snapshot.state).toBe('error');expect(b.snapshot.state).toBe('loading');a.dispose();const previous=a.snapshot;callback(0,'onplay');callback(0,'onload');expect(a.snapshot).toBe(previous);b.dispose();expect(revoke).toHaveBeenCalledTimes(2);
});

it('registers the provider and descriptor through the real host namespace contract',async()=>{const host=new ModuleHost();await host.start([{manifest:{id:'audio',version:'1.0.0',apiVersion:1},activate(){}},howlerModule]);expect(host.states.get('howler')).toBe('active');expect(host.entries(audioProviders)).toHaveLength(1);expect(host.entries(providers)).toHaveLength(1);await host.stop();});

it('allows a manual retry after a playback error without resuming a stale sound ID',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([1]))));const a=howlerProvider.create(spec);a.play();await vi.waitFor(()=>expect(mocks.instances).toHaveLength(1));mocks.instances[0].loaded=true;callback(0,'onload');callback(0,'onplayerror',42,'locked');expect(a.snapshot.state).toBe('error');expect(mocks.instances[0].stop).toHaveBeenCalled();a.play();expect(mocks.instances[0].play).toHaveBeenLastCalledWith();callback(0,'onplay');expect(a.snapshot.state).toBe('playing');a.dispose();});

it('ignores an end callback for a superseded play ID and keeps errors through pause',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([1]))));const a=howlerProvider.create({...spec,loop:false});a.play();await vi.waitFor(()=>expect(mocks.instances).toHaveLength(1));mocks.instances[0].loaded=true;callback(0,'onload');a.stop();mocks.instances[0].play.mockReturnValueOnce(84);a.play();callback(0,'onend',42);expect(a.snapshot.state).not.toBe('ended');callback(0,'onplay',84);callback(0,'onplayerror',42,'stale failure');expect(a.snapshot.state).toBe('playing');callback(0,'onend',84);expect(a.snapshot.state).toBe('ended');callback(0,'onloaderror',null,'broken');a.pause();expect(a.snapshot.state).toBe('error');a.dispose();});
it('accepts a same-origin status-0 media body (Capacitor iOS) but rejects opaque, empty and failed responses',async()=>{
 const reply=(status:number,type:ResponseType,bytes:number[])=>({ok:status>=200&&status<300,status,type,arrayBuffer:async()=>new Uint8Array(bytes).buffer})as unknown as Response;
 vi.stubGlobal('fetch',vi.fn(async()=>reply(0,'basic',[1,2,3])));const accepted=howlerProvider.create(spec);await vi.waitFor(()=>expect(mocks.instances).toHaveLength(1));expect(accepted.snapshot.state).toBe('loading');
 for(const [status,type,bytes] of [[0,'opaque',[]],[0,'basic',[]],[404,'basic',[1]],[0,'opaque',[1]]] as [number,ResponseType,number[]][]){vi.stubGlobal('fetch',vi.fn(async()=>reply(status,type,bytes)));const rejected=howlerProvider.create(spec);await vi.waitFor(()=>expect(rejected.snapshot).toMatchObject({state:'error',error:'Error: Audio source unavailable'}));}
 expect(mocks.instances).toHaveLength(1);
});

it('plays overlapping effects up to the limit, steals the oldest and resumes surviving voices',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([1]))));
 const voice=howlerProvider.create({...spec,loop:false,voiceLimit:2});
 try{
  voice.play();
  voice.play();
  await vi.waitFor(()=>expect(mocks.instances).toHaveLength(1));
  const howl=mocks.instances[0];
  howl.loaded=true;
  howl.play.mockReturnValueOnce(11).mockReturnValueOnce(12).mockReturnValueOnce(13);
  callback(0,'onload');
  callback(0,'onplay',11);
  callback(0,'onplay',12);
  expect(voice.snapshot.starts).toBe(2);
  voice.play();
  callback(0,'onplay',13);
  expect(howl.stop.mock.calls).toEqual([[11]]);
  callback(0,'onend',11);
  expect(voice.snapshot.state).toBe('playing');
  voice.pause();
  expect(howl.pause.mock.calls).toEqual([[12],[13]]);
  voice.play();
  expect(howl.play.mock.calls.slice(-2)).toEqual([[12],[13]]);
  callback(0,'onplay',12);
  callback(0,'onplay',13);
  callback(0,'onend',12);
  expect(voice.snapshot.state).toBe('playing');
  callback(0,'onend',13);
  expect(voice.snapshot.state).toBe('ended');
 }finally{voice.dispose();}
});
