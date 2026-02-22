import { World } from 'miniplex';

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
    };

    physicsRope?: {
        headAnchor: { target: Entity | Float32Array; offset: Float32Array };
        tailAnchor: { target: Entity | Float32Array; offset: Float32Array };
        segments: Entity[];
        segmentLength: number;
        compliance: number;
    };

    editor_ui?: {
        visible: boolean;
    };
};

export const world = new World<Entity>();