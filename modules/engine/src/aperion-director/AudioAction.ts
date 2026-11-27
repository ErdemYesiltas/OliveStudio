export type PlayOptions = { volume?: number; loop?: boolean; speed?: number; singleInstance?: boolean; sprite?: string };

/**
 * Discriminated union of every chain step. Each variant has exactly one
 * discriminator key — match with `'<key>' in step`.
 *
 * Every variant is JSON-serializable: closures, instances, and other
 * non-serializable references are only ever held in registries on
 * {@link AudioComposer} and referenced by name from chain data.
 */
export type AudioAction =
    | { play: PlayConfig }
    | { playOnce: PlayConfig }
    | { stop: StopConfig }
    | { fadeLayer: FadeLayerConfig }
    | { fadeAlias: FadeAliasConfig }
    | { fadeMaster: FadeMasterConfig }
    | { crossfade: CrossfadeConfig }
    | { profile: ProfileConfig }
    | { snapshot: SnapshotConfig }
    | { restore: RestoreConfig }
    | { stem: StemConfig }
    | { atNextBeat: true }
    | { atNextBar: number };

/** `{ play }` fires the sound and continues immediately (fire-and-forget). */
export interface PlayConfig {
    layer: string;
    alias: string;
    options?: PlayOptions;
}

/** `{ stop }` — when `alias` is omitted, stops every sound on the layer. */
export interface StopConfig {
    layer: string;
    alias?: string;
}

/** `{ fadeLayer }` — fades every sound on `layer` to `to` over `ms`. */
export interface FadeLayerConfig {
    /** Layer name registered on {@link AudioService}. */
    layer: string;
    /** Target volume in `[0, 1]`. */
    to: number;
    /** Fade duration in milliseconds. */
    ms: number;
}

/** `{ fadeAlias }` — fades a single sound (`alias` on `layer`) to `to` over `ms`. */
export interface FadeAliasConfig {
    layer: string;
    alias: string;
    /** Target volume in `[0, 1]`. */
    to: number;
    /** Fade duration in milliseconds. */
    ms: number;
}

/** `{ fadeMaster }` — fades the master bus to `to` over `ms`. */
export interface FadeMasterConfig {
    /** Target master volume in `[0, 1]`. */
    to: number;
    /** Fade duration in milliseconds. */
    ms: number;
}

/** `{ crossfade }` — replaces the current BGM track with `alias` over `ms`. */
export interface CrossfadeConfig {
    /** BGM alias to fade in. */
    alias: string;
    /** Fade duration in milliseconds. Defaults to the layer's crossfade default. */
    ms?: number;
    /** Target volume of the incoming track. Defaults to `1`. */
    volume?: number;
    /** Loop the incoming track. Defaults to `true` (BGM convention). */
    loop?: boolean;
}

/** `{ profile }` — applies a profile registered on {@link AudioService.profiles}. */
export interface ProfileConfig {
    /** Profile name registered via `app.audio.profiles.register(...)`. */
    name: string;
    /** Fade duration toward the profile's mix in milliseconds. Defaults to `0`. */
    ms?: number;
}

export interface SnapshotConfig {
    /** Slot name to write the snapshot into within the chain context. */
    slot: string;
}

export interface RestoreConfig {
    /** Slot name to read the snapshot from. */
    slot: string;
    /** Optional fade duration for the restore. */
    ms?: number;
}

export interface StemConfig {
    /** Name registered via {@link AudioComposer.registerMusic}. */
    music: string;
    /** Stem name on the resolved {@link AdaptiveMusic} instance. */
    name: string;
    to: number;
    ms?: number;
}
