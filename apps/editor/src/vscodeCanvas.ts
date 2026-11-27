import type { GameSlot, GlobalValues } from './globals';
import type { SceneLink } from './project';

export type CanvasAction =
  | { kind: 'placeAsset' | 'playAsset' | 'previewAsset'; alias: string }
  | { kind: 'placePrefab' | 'variantPrefab'; id: string }
  | { kind: 'capturePrefab' | 'stopAudio' | 'playSceneAudio' | 'pauseSceneAudio' | 'toggleLighting' | 'toggleColliders' |
      'clearProfile' | 'stepPhysics' | 'setupNetwork' | 'goBack' | 'addLight' | 'applyPlatform' }
  | { kind: 'prefabInstance'; mode: 'apply' | 'revert' | 'unpack' }
  | { kind: 'installCharacterKit'; mode: 'platformer' | 'topdown' }
  | { kind: 'runTest'; id: string }
  | { kind: 'chooseBrush'; id: string }
  | { kind: 'network'; action: 'start' | 'stop' | 'client' | 'latency' | 'drop'; value?: string | number }
  | { kind: 'pausePhysics' | 'pauseProfile' | 'eraseBrush'; enabled: boolean }
  | { kind: 'slot'; mode: 'save' | 'load'; slot: GameSlot }
  | { kind: 'global'; id: string; value: GlobalValues[string] }
  | { kind: 'sceneLink'; link: SceneLink }
  | { kind: 'previewEffect'; id: string; index: number }
  | { kind: 'particlePreview' | 'playSource' | 'stopSource' | 'fitPhysics'; id: string };
