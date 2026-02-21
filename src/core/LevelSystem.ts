import * as THREE from 'three';
import { world, type Entity } from '../ecs';
import { WebPhysics, CONFIG } from '../webPhysics';
import { addObject } from './EntityFactory';

export const listLevels = async (): Promise<string[]> => {
    const res = await fetch('/api/levels');
    return await res.json();
};

export const serializeWorld = (physics: WebPhysics) => {
    return {
        entities: world.entities.map(e => ({
            id: e.id,
            name: e.name,
            position: { x: e.position.x, y: e.position.y },
            rotation: e.rotation,
            scale: { x: e.scale.x, y: e.scale.y },
            sdfCollider: e.sdfCollider,
            physics: e.physics ? { bodyType: e.physics.bodyType, mass: e.physics.mass, radius: e.physics.radius } : undefined,
            attachable: e.attachable,
            friction: e.friction,
            tags: e.tags,
            special: e.special
        })),
        ropes: physics.ropes.map(r => {
            const pins: any[] = [];
            const uv = new Uint32Array(physics.distConstraints.buffer);
            
            r.anchorConstraints.forEach((cIdx: number) => {
                const off = cIdx * 8;
                const a = uv[off], b = uv[off+1];
                const ropeNodeIdxInGlobal = r.indices.indexOf(a) !== -1 ? a : b;
                const targetIdxInGlobal = ropeNodeIdxInGlobal === a ? b : a;
                
                const targetEnt = world.entities.find(e => e.physics?.particleIdx === targetIdxInGlobal);
                if (targetEnt) {
                    pins.push({
                        nodeIdx: r.indices.indexOf(ropeNodeIdxInGlobal),
                        targetEntityId: targetEnt.id,
                        length: physics.distConstraints[off + 2]
                    });
                }
            });

            return {
                nodes: r.indices.map((idx: number) => {
                    const off = idx * 8;
                    return {
                        x: physics.particles[off], 
                        y: physics.particles[off+1],
                        invMass: physics.particles[off+6]
                    };
                }),
                pins
            };
        })
    };
};

export const deserializeWorld = async (state: any, engine: any) => {
    engine.clearScene();
    const idToEnt = new Map<string, Entity>();

    for (const entData of state.entities) {
        const ent = addObject(engine.physics, entData.tags[0] as any, entData.sdfCollider?.type || (entData.special?.type === 'player_spawn' ? 'spawn_point' : 'circle'), {
            ...entData,
            position: new THREE.Vector2(entData.position.x, entData.position.y),
            scale: new THREE.Vector2(entData.scale.x, entData.scale.y)
        });
        if (ent) idToEnt.set(ent.id, ent);
    }

    for (const ropeData of state.ropes) {
        rebuildRope(engine.physics, ropeData.nodes, ropeData.pins, idToEnt);
    }

    engine.physics.syncGPU();
    engine.physics.updateVisuals();
};

export const saveLevel = async (name: string, physics: WebPhysics) => {
    const state = serializeWorld(physics);
    await fetch(`/api/levels?name=${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
    });
};

export const loadLevel = async (name: string, engine: any) => {
    const res = await fetch(`/api/levels?name=${name}`);
    if (!res.ok) return;
    const state = await res.json();
    await deserializeWorld(state, engine);
};

const rebuildRope = (physics: WebPhysics, nodes: any[], pins: any[], idToEnt: Map<string, Entity>) => {
    if (nodes.length < 2) return;
    
    const pIndices: number[] = [];
    for (const n of nodes) {
        const idx = physics.allocParticle();
        if (idx !== -1) {
            physics.setParticle(idx, new THREE.Vector2(n.x, n.y), n.invMass);
            physics.setParticleFree(idx, false);
            pIndices.push(idx);
        }
    }

    const cIndices: number[] = [];
    for (let i = 0; i < pIndices.length - 1; i++) {
        const cIdx = physics.allocConstraint();
        if (cIdx !== -1) {
            const color = physics.assignColor(pIndices[i], pIndices[i+1]);
            physics.setDistConstraint(cIdx, pIndices[i], pIndices[i+1], CONFIG.SEGMENT_LENGTH, CONFIG.ROPE_COMPLIANCE, color);
            cIndices.push(cIdx);
        }
    }

    const anchorConstraints: number[] = [];
    if (pins) {
        for (const pin of pins) {
            const targetEnt = idToEnt.get(pin.targetEntityId);
            if (targetEnt && targetEnt.physics?.particleIdx !== undefined) {
                const ropeNodeIdx = pIndices[pin.nodeIdx];
                const targetIdx = targetEnt.physics.particleIdx;
                const cIdx = physics.allocConstraint();
                if (cIdx !== -1) {
                    const color = physics.assignColor(ropeNodeIdx, targetIdx);
                    physics.setDistConstraint(cIdx, ropeNodeIdx, targetIdx, pin.length, 0, color);
                    physics.constraintVisible[cIdx] = 0;
                    anchorConstraints.push(cIdx);
                }
            }
        }
    }

    physics.ropes.push({
        indices: pIndices,
        constraintIndices: cIndices,
        anchorConstraints,
        segments: pIndices.length - 1,
        segmentLength: CONFIG.SEGMENT_LENGTH
    });
};