import * as THREE from 'three';
import { world, type Entity } from '../ecs';
import { createSDFMaterial } from '../materials/sdfMaterial';

export const addObject = (scene: THREE.Scene | null, type: 'static' | 'dynamic', shape: string, position: THREE.Vector2): Entity => {
    const id = Math.random().toString(36).substr(2, 9);
    const isStatic = type === 'static';
    const params: [number, number, number, number] = shape === 'circle' ? [0.5, 0, 0, 0] : [10, 1, 0, 0];
    
    const sizeForMat = shape === 'circle' ? new THREE.Vector2(params[0], params[0]) : new THREE.Vector2(params[0] * 2, params[1] * 2);
    const boundsX = params[0] * 2 + 1.0;
    const boundsY = (shape === 'circle' ? params[0] : params[1]) * 2 + 1.0;
    const meshScale = new THREE.Vector2(boundsX, boundsY);

    const ent: Entity = {
        id, name: `${type}_${shape}_${id}`, tags: [type],
        transform: { position: position.clone(), rotation: 0 },
        velocity: new THREE.Vector2(),
        force: new THREE.Vector2(),
        physicsBody: { isStatic, mass: isStatic ? 0 : 10, friction: 0.5, collisionMask: 0xFF, groupId: 0, appearance: isStatic ? 1 : 2, flags: 0 },
        sdfCollider: { shapeType: shape === 'circle' ? 0 : 1, parameters: params, rotation: 0 }
    };

    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2), 
        createSDFMaterial(
            ent.sdfCollider.shapeType, 
            sizeForMat, 
            new THREE.Vector2(0,0), 
            new THREE.Color(isStatic ? 0x444444 : 0x00ff88), 
            meshScale.clone().multiplyScalar(0.5)
        ).mat
    );
    
    mesh.scale.set(meshScale.x / 2, meshScale.y / 2, 1);
    mesh.position.set(position.x, position.y, -0.1);
    ent.renderable = { mesh };

    world.add(ent);
    if (scene) scene.add(mesh);
    return ent;
};
