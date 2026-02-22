import { world, type Entity } from '../ecs';
import { WebPhysics } from '../webPhysics';

export const addObject = (physics: WebPhysics, type: 'static' | 'dynamic', shape: string, position: Float32Array, customRadius?: number, appearance?: number): Entity => {
    const id = Math.random().toString(36).substr(2, 9);
    const isStatic = type === 'static';
    const radius = customRadius ?? 0.5;
    const params = new Float32Array(shape === 'circle' ? [radius, 0, 0, 0] : [1.0, 0.5, 0, 0]);

    const ent: Entity = {
        id, name: `${type}_${shape}_${id}`, tags: [type],
        transform: { position: new Float32Array(position), rotation: 0 },
        velocity: new Float32Array([0, 0]),
        force: new Float32Array([0, 0]),
        sdfCollider: { shapeType: shape === 'circle' ? 0 : 1, parameters: params, rotation: 0 }
    };

    if (isStatic) {
        if(!ent.sdfCollider) throw new Error('sdfCollider is undefined');
        ent.staticBody = { friction: 0.5, appearance: appearance ?? 1, flags: 0 };
        ent.editor_ui = { visible: true };
        const idx = physics.numObstacles++;
        physics.setObstacle(idx, position, 0, ent.sdfCollider.shapeType, params, 0.5, ent.staticBody.appearance, 0);
    } else {
        ent.physicsBody = { mass: 1.0, friction: 0.5, collisionMask: 0xFF, groupId: 0, appearance: appearance ?? 2, flags: 0 };
        if (appearance !== 6) {
            ent.editor_ui = { visible: true };
        }
        const indices = physics.allocateParticles(1);
        const idx = indices[0];
        if (idx !== undefined) {
            world.addComponent(ent, 'physicsParticle', { index: idx });
            physics.setParticle(idx, position, position, 1.0, 0.5, params[0]!, 0xFF, ent.physicsBody.appearance, 0);
        }
    }

    world.add(ent);
    return ent;
};