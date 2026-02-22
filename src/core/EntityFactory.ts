import { world, type Entity } from '../ecs';
import { WebPhysics } from '../webPhysics';
import { markRaw } from 'vue';
import { BOUNDS } from '../constants';

export const addObject = (physics: WebPhysics, type: 'static' | 'dynamic', shape: string, position: Float32Array, customRadius?: number, appearance?: number): Entity => {
    const id = Math.random().toString(36).substr(2, 9);
    const isStatic = type === 'static';
    const radius = customRadius ?? 0.5;
    let shapeType = 1;
    let params = new Float32Array([1.0, 0.5, 0, 0]);

    if (shape === 'circle') {
        shapeType = 0;
        params = new Float32Array([radius, 0, 0, 0]);
    } else if (shape === 'rounded_box') {
        shapeType = 3;
        params = new Float32Array([1.0, 0.5, 0.1, 0]);
    }

    const ent: Entity = {
        id, name: `${type}_${shape}_${id}`, tags: [type],
        transform: { position: new Float32Array(position), rotation: 0 },
        velocity: new Float32Array([0, 0]),
        force: new Float32Array([0, 0]),
        sdfCollider: { shapeType, parameters: params, rotation: 0 }
    };

    if (isStatic) {
        if(!ent.sdfCollider) throw new Error('sdfCollider is undefined');
        ent.staticBody = { friction: 0.5, appearance: appearance ?? 1, flags: 0 };
        ent.editor_ui = { visible: true };
    } else {
        ent.physicsBody = { mass: 1.0, friction: 0.5, collisionMask: 0xFF, groupId: 0, appearance: appearance ?? 2, flags: 0 };
        if (appearance !== 6) {
            ent.editor_ui = { visible: true };
        }
    }

    const rawEnt = markRaw(ent);
    world.add(rawEnt);
    return rawEnt;
};

export const createWorldBounds = (physics: WebPhysics): Entity => {
    const ent: Entity = {
        id: 'world_bounds', 
        name: 'World Bounds', 
        tags: ['static', 'bounds'],
        transform: { position: new Float32Array([0, 0]), rotation: 0 },
        staticBody: { friction: 0.1, appearance: 7, flags: 0 },
        sdfCollider: { 
            shapeType: 2, 
            parameters: new Float32Array([BOUNDS.width, BOUNDS.height, 0, 0]), 
            rotation: 0 
        },
        editor_ui: { visible: true }
    };
    const rawEnt = markRaw(ent);
    world.add(rawEnt);
    return rawEnt;
};