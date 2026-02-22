import { vec2 } from 'wgpu-matrix';
import { world, type Entity } from '../ecs';
import { addObject } from './EntityFactory';
import { WebPhysics } from '../webPhysics';

export const RopeSystem = {
    update: (physics: WebPhysics, mouseWorld: Float32Array) => {
        for (const ropeEnt of world.with('physicsRope')) {
            const rope = ropeEnt.physicsRope;
            if (rope.segments.length < 1) continue;

            const lastEnt = rope.segments[rope.segments.length - 1]!;
            if (!lastEnt.transform) continue;

            if (ropeEnt.tags.includes('building')) {
                lastEnt.transform.position.set(mouseWorld);
                if (lastEnt.physicsParticle) {
                    // Fast GPU update to track mouse perfectly without halting the rest of the simulation
                    physics.updateParticlePos(lastEnt.physicsParticle.index, mouseWorld);
                }
                
                const engine = (window as any).engine;
                const isAuto = engine ? engine.ropeMode === 'auto' : true;

                if (isAuto && rope.segments.length > 1) {
                    const prevEnt = rope.segments[rope.segments.length - 2]!;
                    const dist = vec2.distance(prevEnt.transform!.position, mouseWorld);
                    
                    if (dist > rope.segmentLength * 1.5 && rope.segments.length < 100) {
                        const newPos = vec2.lerp(prevEnt.transform!.position, mouseWorld, 0.5);
                        const newSeg = addObject(physics, 'dynamic', 'circle', newPos as Float32Array, 0.05, 6);
                        newSeg.name = `rope_seg_${ropeEnt.id}`;
                        newSeg.physicsBody!.mass = 0.1;
                        newSeg.physicsBody!.collisionMask = 0; // Rope segments shouldn't collide by default

                        rope.segments.splice(rope.segments.length - 1, 0, newSeg);

                        const oldC = world.entities.find(e => e.physicsConstraint && 
                            e.physicsConstraint.targetA === prevEnt && 
                            e.physicsConstraint.targetB === lastEnt);
                        if (oldC) world.remove(oldC);

                        RopeSystem.createLink(prevEnt, newSeg, rope.segmentLength, rope.compliance);
                        RopeSystem.createLink(newSeg, lastEnt, rope.segmentLength, rope.compliance);
                        if (engine && engine.onRopeStateChange) engine.onRopeStateChange();
                    }
                }
            }

            const headEnt = rope.segments[0]!;
            if (headEnt && headEnt.transform) {
                if (!(rope.headAnchor.target instanceof Float32Array)) {
                    const targetEnt = rope.headAnchor.target;
                    if (targetEnt && targetEnt.transform) {
                        vec2.add(targetEnt.transform.position, rope.headAnchor.offset, headEnt.transform.position);
                    }
                } else {
                    vec2.add(rope.headAnchor.target, rope.headAnchor.offset, headEnt.transform.position);
                }
            }
        }
    },

    createLink: (a: Entity, b: Entity | Float32Array, rest: number, compliance: number) => {
        world.add({
            id: Math.random().toString(36).substr(2, 9),
            name: 'rope_constraint',
            tags: ['constraint', 'rope'],
            physicsConstraint: {
                type: (b instanceof Float32Array) ? 3 : 0,
                targetA: a,
                targetB: b,
                restValue: rest,
                compliance: compliance,
                index: -1
            }
        });
    }
};