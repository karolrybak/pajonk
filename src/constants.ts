export const BOUNDS = { width: 24, height: 14 };

export const MATERIALS = {
    STATIC: 1,
    DYNAMIC: 2,
    WOOD: 3,
    METAL: 4,
    RUBBER: 5,
    ROPE: 6,
    WORLD_BORDER: 7
};

export const MATERIAL_COLORS = {
    1: 0x444444, // Static
    2: 0x00ff88, // Dynamic
    3: 0x8b4513, // Wood
    4: 0x708090, // Metal
    5: 0x800080, // Rubber
    6: 0xffffff, // Rope
    7: 0x2a2a30  // World Border (Dark Gray-Blue)
};

/**
 * Collision Layers (8 bits available: 0-7)
 * Objects collide if (A.mask & B.mask) != 0
 */
export const COLLISION_LAYERS = {
    DEFAULT: 0x01,      // Bit 0: Standard solid objects
    PLAYER:  0x02,      // Bit 1: The spider body/legs
    ENVIRONMENT: 0x04,  // Bit 2: Walls and floors
    // ... bits 3-6 free
    SPIDER_SILK: 0x80   // Bit 7: Reserved for your spider webbing
};

export const PHYSICS_CONFIG = {
    DT: 1 / 60,
    SUBSTEPS: 24,
    CONSTRAINT_ITERATIONS: 1, // Iterations of the solver per substep
    COLLISION_ITERATIONS: 1,  // Iterations of collisions per substep
    GRAVITY: [0, -9.81] as [number, number]
};