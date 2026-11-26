import {afterEach,expect,it,vi} from 'vitest';
import {TexturePool} from './textures';

const image=vi.hoisted(()=>({from:vi.fn()}));
vi.mock('pixi.js',()=>({Texture:image}));
afterEach(()=>{
 vi.unstubAllGlobals();
 image.from.mockReset();
});

it('shares the decoded texture and releases it only with the last lease',async()=>{
 const bitmap={close:vi.fn()},texture={source:{scaleMode:'linear'},destroy:vi.fn()};
 const fetch=vi.fn(async()=>new Response('image'));
 vi.stubGlobal('fetch',fetch);
 vi.stubGlobal('createImageBitmap',vi.fn(async()=>bitmap));
 image.from.mockReturnValue(texture);
 const pool=new TexturePool();
 const first=pool.acquire('/image'),second=pool.acquire('/image');
 const decoded=await second.ready;
 expect(await first.ready).toBe(decoded);
 expect(fetch).toHaveBeenCalledTimes(1);
 pool.setFiltering('nearest');
 await Promise.resolve();
 expect(texture.source.scaleMode).toBe('nearest');
 first.release();
 first.release();
 expect(bitmap.close).not.toHaveBeenCalled();
 second.release();
 expect(texture.destroy).toHaveBeenCalledOnce();
 expect(bitmap.close).toHaveBeenCalledOnce();
});

it('releases a late bitmap and leaves the replacement lease alive',async()=>{
 let finish!:(bitmap:{close:()=>void})=>void;
 const closed=vi.fn(),live=vi.fn(),texture={source:{scaleMode:'linear'},destroy:vi.fn()};
 const decode=vi.fn()
  .mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}))
  .mockResolvedValueOnce({close:live});
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('image')));
 vi.stubGlobal('createImageBitmap',decode);
 image.from.mockReturnValue(texture);
 const pool=new TexturePool();
 const old=pool.acquire('/image');
 const cancelled=expect(old.ready).rejects.toMatchObject({name:'AbortError'});
 await vi.waitFor(()=>expect(decode).toHaveBeenCalledOnce());
 old.release();
 const replacement=pool.acquire('/image');
 finish({close:closed});
 await cancelled;
 expect(await replacement.ready).toBe(texture);
 expect(closed).toHaveBeenCalledOnce();
 expect(live).not.toHaveBeenCalled();
 pool.dispose();
 expect(live).toHaveBeenCalledOnce();
});
