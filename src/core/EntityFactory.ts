import * as THREE from 'three';
import { world, type Entity } from '../ecs';
import { WebPhysics } from '../webPhysics';
import { createSDFMaterial } from '../materials/sdfMaterial';

export const addObject = (physics: WebPhysics, type: 'static' | 'dynamic' | 'special', shape: any, data?: Partial<Entity>): Entity | undefined => {
    if (!physics) return;
    const id = data?.id || Math.random().toString(36).substr(2, 9);
    const name = data?.name || `${type}_${shape}_${id}`;
    const pos = data?.position || new THREE.Vector2(0, 0);
    let pIdx: number | undefined;
    
    // Restore original defaults while allowing data overrides
    const initialRadius = data?.physics?.radius ?? (shape === 'circle' ? 1.0 : 0.5);
    const initialSize = data?.sdfCollider?.size ?? new THREE.Vector2(2, 2);

    if (type === 'dynamic') {
        pIdx = physics.spawnBall(pos, 'dynamic', initialRadius, data?.physics?.mass ?? 10.0);
    }

    let mesh: THREE.Mesh;
    if (type === 'static') {
        const geo = new THREE.PlaneGeometry(2, 2);
        const shapeTypes = ['circle', 'box', 'rounded_box', 'capsule', 'vesica'];
        const shapeTypeIdx = Math.max(0, shapeTypes.indexOf(shape));
        const size = new THREE.Vector2(shape === 'circle' ? initialRadius : initialSize.x, shape === 'circle' ? initialRadius : initialSize.y);
        const extra = new THREE.Vector2(data?.scale?.x ?? 0.2, data?.scale?.y ?? 0);
        const bounds = Math.max(size.x, size.y) + Math.abs(extra.x) + 1.0;
        
        const { mat, uniforms } = createSDFMaterial(shapeTypeIdx, size, extra, new THREE.Color(0x444444), new THREE.Vector2(bounds, bounds));
        
        mesh = new THREE.Mesh(geo, mat);
        mesh.scale.set(bounds, bounds, 1);
        mesh.userData.uniforms = uniforms;
    } else if (type === 'special') {
        const mat = new THREE.MeshBasicMaterial({ color: 0xaa00ff, transparent: true, opacity: 0.7 });
        const geo = new THREE.CircleGeometry(0.5, 32);
        mesh = new THREE.Mesh(geo, mat);
    } else {
        const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
        const geo = new THREE.CircleGeometry(1, 32);
        mesh = new THREE.Mesh(geo, mat);
        mesh.scale.set(initialRadius, initialRadius, 1);
    }

    mesh.position.set(pos.x, pos.y, -0.1);
    mesh.rotation.z = data?.rotation || 0;
    physics.scene.add(mesh);

    const ent: Entity = {
        id, name, position: pos.clone(), rotation: data?.rotation || 0, scale: new THREE.Vector2(0.2, 0.2), friction: data?.friction ?? 0.5,
        sdfCollider: type === 'static' ? { type: shape, size: shape === 'circle' ? new THREE.Vector2(initialRadius, 0) : initialSize.clone() } : undefined,
        physics: type === 'dynamic' ? { bodyType: 'dynamic', mass: data?.physics?.mass ?? 10, invMass: 1.0 / (data?.physics?.mass ?? 10), radius: initialRadius, particleIdx: pIdx } : undefined,
        special: type === 'special' ? { type: 'player_spawn' } : undefined,
        playerPart: data?.playerPart,
        renderable: { mesh }, attachable: true, tags: [type]
    };
    world.add(ent);
    return ent;
};

export const deleteEntity = (physics: WebPhysics, ent: Entity) => {
    if (!physics) return;
    if (ent.renderable) physics.scene.remove(ent.renderable.mesh);
    if (ent.physics?.particleIdx !== undefined) physics.freeParticle(ent.physics.particleIdx);
    world.remove(ent);
};

export const updatePhysicsFromUI = (physics: WebPhysics, ent: Entity) => {
    if (!physics) return;
    if (ent.physics?.particleIdx !== undefined) {
        physics.setParticlePos(ent.physics.particleIdx, ent.position);
        physics.syncGPU();
    }
};
