import {expect, it} from 'vitest';
import {makeEntity} from '@rewrite/scene';
import {compilePhysics, worldTransform} from './index';

it('puts bodies at the pivot and measures collider offsets from it', () => {
 const crate = makeEntity('Crate');
 crate.components[0].data = {x: 300, y: 200, rotation: 0, scaleX: 2, scaleY: 1, pivotX: 10, pivotY: 0};
 crate.components.push({id: 'box', type: 'physics.boxCollider2d', version: 1, data: {width: 40, height: 20, offsetX: 10, offsetY: 0, chamfer: 0, sensor: false}});
 expect(worldTransform(new Map([[crate.id, crate]]), crate.id)).toMatchObject({x: 300, y: 200, pivotX: 10});
 const {plans, errors} = compilePhysics([crate]);
 expect(errors).toEqual([]);
 const spec = plans[0].spec;
 expect([spec.x, spec.y]).toEqual([300, 200]);
 // The collider is centred on the pivot (offset 10 − pivot 10 = 0) and scaled 2 × 1.
 expect(spec.parts[0]).toMatchObject({kind: 'box', x: 0, y: 0, width: 80, height: 20});
});
