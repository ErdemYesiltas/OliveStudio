import {expect,it} from 'vitest';
import {newProject} from '@rewrite/project';
import {makeEntity,blankScene} from '@rewrite/scene';
import {presets,section} from '@rewrite/particles/contracts';
import {createStockRegistry} from './stock';
it('exports built-in particle textures through the shared objects runtime and strips authoring presets',()=>{const scene=blankScene(),e=makeEntity('Fire');e.components.push({id:'emitter',type:'pixi.particles',version:1,data:presets[0].settings});scene.entities=[e];const p=newProject(scene);p.modules={particles:'1.0.0'};p.extensions[section]={version:1,items:[{id:'custom',name:'My fire',settings:presets[0].settings}]};const plan=createStockRegistry().plan(p);expect(plan.runtimes).toContain('objects');expect(plan.assets).toEqual([]);expect(plan.project.extensions[section]).toBeUndefined();expect(plan.project.scenes[0].entities[0].components[1].data).toMatchObject({particleTexture:'soft',spawnShape:'circle'});});
