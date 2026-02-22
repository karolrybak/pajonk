import { World } from 'miniplex';
import { markRaw } from 'vue';

export type Entity = {
    id: string;
    name: string;
    tags: string[];

    transform?: {
        position: Float32Array;
        rotation: number;
    };

    velocity?: Float32Array;
    force?: Float32Array;

    physicsBody?: {
        mass: number;
        friction: number;
        collisionMask: number;
        groupId: number;
        appearance: number;
        flags: number;
        isDirty?: boolean;
    };

    staticBody?: {
        friction: number;
        appearance: number;
        flags: number;
    };

    sdfCollider?: {
        shapeType: number;
        parameters: Float32Array;
        rotation: number;
    };

    physicsParticle?: {
        index: number;
    };

    physicsConstraint?: {
        type: number;
        targetA: Entity;
        targetB: Entity | Float32Array;
        targetC?: Entity;
        restValue: number;
        compliance: number;
        index: number;
        color?: number;
        isSynced?: boolean;
        isDirty?: boolean; // Explicit flag for value updates
    };

    physicsRope?: {
        headAnchor: { target: Entity | Float32Array; offset: Float32Array };
        tailAnchor: { target: Entity | Float32Array; offset: Float32Array };
        segments: Entity[];
        segmentLength: number;
        compliance: number;
    };

    mesh?: {
        vertices: Float32Array;
        indices: Uint16Array;
        uvs: Float32Array;
        textureUrl?: string;
    };

    editor_ui?: {
        visible: boolean;
    };
};

export const world = new World<Entity>();