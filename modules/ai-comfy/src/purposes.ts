import type {AnimationMethod, workflowNeeds} from './contracts';

/**
 * What the Generate panel makes: an area (image, audio, video) and a purpose inside it. The purpose decides which
 * workflows fit, which options the panel shows and their defaults (sizes, duration, background removal, prompt hints).
 */
export type Area = 'image' | 'audio' | 'video';
export const areas: readonly Area[] = ['image', 'audio', 'video'];
type Needs = ReturnType<typeof workflowNeeds>;
export interface Purpose {
 id: string; area: Area;
 /** Sub-heading it is listed under. */
 group?: 'create' | 'change' | 'animate';
 /** Animations: how the frames are made (absent: one image or sound per run). */
 method?: AnimationMethod;
 /** Wrapped around the prompt ({prompt} is the user's text) unless a skill brings its own template. */
 hint?: string;
 /** What the prompt writer is told the asset is. */
 brief: string;
 /** Sizes as aspect ratios (first is the default), scaled to the workflow's native resolution. */
 aspects?: readonly (readonly [number, number])[];
 /** Duration range and default (audio). */
 seconds?: {min: number; max: number; value: number};
 /** Background removal is offered (and on by default when true). */
 cutout?: boolean;
 /** Needs a workflow with an input image (the selected sprite). */
 input?: boolean;
 /** Song: a workflow with lyrics (ACE-Step). */
 lyrics?: boolean;
 loop?: boolean;
 /** Message key shown when no workflow fits. */
 needs: string;
}
const sprite = '{prompt}, single game sprite, centered, full view, plain flat background';
export const purposes: readonly Purpose[] = [
 {id: 'image.sprite', area: 'image', group: 'create', hint: sprite, brief: 'a single 2D game sprite (character or object), centred on a plain background', aspects: [[1, 1], [2, 3], [3, 2]], cutout: true, needs: 'comfy.needs.image'},
 {id: 'image.background', area: 'image', group: 'create', hint: '{prompt}, game background, wide environment, no characters, no text', brief: 'a wide 2D game background scene with no characters or text', aspects: [[16, 9], [9, 16], [4, 3], [21, 9]], needs: 'comfy.needs.image'},
 {id: 'image.icon', area: 'image', group: 'create', hint: '{prompt}, game UI icon, centered, bold simple shape, clean outline, plain background', brief: 'a game UI icon or pickup: one bold, simple, readable shape, centred on a plain background', aspects: [[1, 1]], cutout: true, needs: 'comfy.needs.image'},
 {id: 'image.texture', area: 'image', group: 'create', hint: '{prompt}, seamless tileable texture, flat even lighting, top-down, no objects', brief: 'a seamless tileable game texture (ground, wall, pattern), flat lighting, top-down', aspects: [[1, 1], [2, 1]], needs: 'comfy.needs.image'},
 {id: 'image.edit', area: 'image', group: 'change', input: true, brief: 'an edit instruction for the selected game sprite (what to change, keep the rest)', cutout: false, needs: 'comfy.needs.input'},
 {id: 'image.sheet', area: 'image', group: 'animate', method: 'sheet', hint: sprite, brief: 'an animated 2D game sprite (one character or object) on a plain background', aspects: [[1, 1]], cutout: true, loop: true, needs: 'comfy.needs.sheet'},
 {id: 'image.frames', area: 'image', group: 'animate', method: 'edit', brief: 'an animated 2D game sprite (one character or object) on a plain background', cutout: true, loop: true, needs: 'comfy.needs.edit'},
 {id: 'audio.sfx', area: 'audio', hint: '{prompt}, short game sound effect, clean, no music', brief: 'a short one-shot game sound effect (no music)', seconds: {min: 1, max: 10, value: 2}, needs: 'comfy.needs.audio'},
 {id: 'audio.music', area: 'audio', hint: '{prompt}, instrumental game music, seamless loop', brief: 'looping instrumental background music for a game (genre, instruments, mood, BPM)', seconds: {min: 5, max: 300, value: 30}, needs: 'comfy.needs.audio'},
 {id: 'audio.ambience', area: 'audio', hint: '{prompt}, ambient background soundscape, steady, no music', brief: 'a steady ambient background soundscape for a game level (no music)', seconds: {min: 5, max: 120, value: 20}, needs: 'comfy.needs.audio'},
 {id: 'audio.song', area: 'audio', lyrics: true, brief: 'a song with sung vocals for a game (genre, voice, mood, BPM); the lyrics are separate', seconds: {min: 10, max: 300, value: 60}, needs: 'comfy.needs.song'},
 {id: 'video.sprite', area: 'video', method: 'video', hint: '{prompt}, single character, plain background, static camera', brief: 'a short animation of one game character or object on a plain background, static camera', cutout: true, loop: true, needs: 'comfy.needs.video'},
 {id: 'video.selection', area: 'video', method: 'video', input: true, brief: 'how the selected game sprite moves (the motion), static camera', cutout: true, loop: true, needs: 'comfy.needs.videoImage'},
 {id: 'video.effect', area: 'video', method: 'video', hint: '{prompt}, visual effect, centered, black background, static camera', brief: 'a short game visual effect (explosion, magic, smoke…) centred on a black background, static camera', cutout: false, loop: false, needs: 'comfy.needs.video'},
];
export const purposeById = (id: string) => purposes.find(p => p.id === id) ?? purposes[0];
export const purposesOf = (area: Area) => purposes.filter(p => p.area === area);

/** Whether a workflow can make this purpose. */
export function fits(p: Purpose, n: Needs): boolean {
 if (p.area === 'audio') return n.kind === 'audio' && (!p.lyrics || n.lyrics);
 if (p.area === 'video') return n.kind === 'video' && (!p.input || n.image);
 if (n.kind !== 'image') return false;
 if (p.method) return n.prompt && (p.method === 'edit' ? n.image : !n.image);
 return Boolean(p.input) === n.image;
}
/** The purpose for a workflow: the current one when it fits, else the first of the workflow's area that does. */
export function purposeFor(n: Needs, current: Purpose): Purpose {
 if (fits(current, n)) return current;
 const area: Area = n.kind;
 return purposesOf(area).find(p => fits(p, n)) ?? purposesOf(area)[0];
}
/** A size with this aspect ratio and about `side`² pixels, in steps of 16 (what diffusion models like). */
export function sizeFor([w, h]: readonly [number, number], side: number) {
 const r = Math.sqrt(w / h), snap = (v: number) => Math.min(4096, Math.max(64, Math.round(v / 16) * 16));
 return {width: snap(side * r), height: snap(side / r)};
}
export const sizePresets = (p: Purpose, side: number) => (p.aspects ?? []).map(a => ({label: `${a[0]}:${a[1]}`, ...sizeFor(a, side)}));
