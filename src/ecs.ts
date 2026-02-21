import { World } from 'miniplex';
import * as THREE from 'three';

export type Entity = {
    id: string;
    name: string;
    position: THREE.Vector2;
    rotation: number;
    scale: THREE.Vector2;
    sdfCollider?: {
        type: 'circle' | 'box';
        size: THREE.Vector2;
    };
    physics?: {
        bodyType: 'dynamic' | 'static' | 'kinematic';
        mass: number;
        invMass: number;
        radius: number;
        particleIdx?: number;
    };
    renderable?: {
        mesh: THREE.Object3D;
    };
    attachable: boolean;
    friction?: number;
    selected?: boolean;
    tags: string[];
    special?: {
        type: 'player_spawn';
    };
    playerPart?: {
        role: 'head' | 'torso';
    };
};

export const world = new World<Entity>();