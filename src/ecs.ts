import { World } from 'miniplex';
import * as THREE from 'three';

export type Entity = {
    id: string;
    name: string;
    tags: string[];

    transform?: {
        position: THREE.Vector2;
        rotation: number;
    };

    velocity?: THREE.Vector2;
    force?: THREE.Vector2;

    physicsBody?: {
        isStatic: boolean;
        mass: number;
        friction: number;
        collisionMask: number;
        groupId: number;
        appearance: number;
        flags: number;
    };

    sdfCollider?: {
        shapeType: number;
        parameters: [number, number, number, number];
        rotation: number;
    };

    physicsParticle?: {
        index: number;
    };

    physicsConstraint?: {
        type: number;
        targetA: string;
        targetB: string | THREE.Vector2;
        targetC?: string;
        restValue: number;
        stiffness: number;
        index: number;
    };

    physicsRope?: {
        headAnchor: { target: string | THREE.Vector2; offset: THREE.Vector2 };
        tailAnchor: { target: string | THREE.Vector2; offset: THREE.Vector2 };
        segments: string[];
        segmentLength: number;
        compliance: number;
    };

    renderable?: {
        mesh: THREE.Object3D;
    };
};

export const world = new World<Entity>();
