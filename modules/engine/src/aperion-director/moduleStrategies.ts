import { defer, of } from 'rxjs';
import { z } from 'zod';
import type { DirectorService } from './DirectorService.js';
import type { DirectorStep } from './DirectorTypes.js';
import type { IStepStrategy, StepContext } from './strategies/IStepStrategy.js';

export const directorAudioActions = ['play', 'stop', 'pause', 'resume', 'gain'] as const;
export const directorSceneActions = ['replace', 'add', 'push', 'remove', 'pop'] as const;
export const directorDialogueActions = ['start', 'advance', 'stop'] as const;
export const directorPhysicsActions = ['impulse', 'force', 'velocity', 'teleport', 'gravity', 'angularVelocity'] as const;

const target = z.string().min(1);
const vector = z.number().finite().min(-1e6).max(1e6);
const audioSourceStep = z.strictObject({
    type: z.literal('audioSource'), target, action: z.enum(directorAudioActions), gain: z.number().min(0).max(4).optional(),
});
const sceneStep = z.strictObject({
    type: z.literal('scene'), action: z.enum(directorSceneActions), target: z.string().optional(),
}).refine(step => step.action === 'pop' || !!step.target, { message: 'Select a scene' });
const physicsStep = z.strictObject({
    type: z.literal('physics'), action: z.enum(directorPhysicsActions), target: z.string().optional(),
    x: vector, y: vector,
}).refine(step => step.action === 'gravity' || !!step.target, { message: 'Select a physics body' });
const particlesStep = z.strictObject({ type: z.literal('particles'), target });
const dialogueStep = z.strictObject({ type: z.literal('dialogue'), target: z.string().optional(), action: z.enum(directorDialogueActions) })
  .refine(step => step.action !== 'start' || !!step.target, { message: 'Select a dialogue' });
const globalStep = z.strictObject({ type: z.literal('global'), target, value: z.string().max(1000) });
const visibilityStep = z.strictObject({ type: z.literal('visibility'), target, visible: z.boolean() });

export interface DirectorModulePorts {
    audioSource(step: z.output<typeof audioSourceStep>): void;
    scene(step: z.output<typeof sceneStep>): void;
    physics(step: z.output<typeof physicsStep>): void;
    particles(step: z.output<typeof particlesStep>): void;
    dialogue?(step: z.output<typeof dialogueStep>): void;
    global(step: z.output<typeof globalStep>): void;
    visibility(step: z.output<typeof visibilityStep>): void;
}

export function registerModuleStrategies(director: DirectorService, ports: DirectorModulePorts) {
    function register<T extends DirectorStep>(type: string, schema: z.ZodType<T>, apply: (step: T) => void) {
        const strategy: IStepStrategy = {
            type,
            run: (step: DirectorStep, _context: StepContext) => defer(() => {
                apply(schema.parse(step));
                return of(undefined);
            }),
        };
        director.registerStrategy(strategy);
    }
    register('audioSource', audioSourceStep, ports.audioSource);
    register('scene', sceneStep, ports.scene);
    register('physics', physicsStep, ports.physics);
    register('particles', particlesStep, ports.particles);
    if (ports.dialogue) register('dialogue', dialogueStep, ports.dialogue);
    register('global', globalStep, ports.global);
    register('visibility', visibilityStep, ports.visibility);
}
