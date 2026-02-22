import { WebPhysics, type SimulationParams } from '../webPhysics';
import { BOUNDS } from '../constants';
import { world, type Entity } from '../ecs';
import { RopeSystem } from './RopeSystem';
import { Renderer } from './Renderer';

export class AppEngine {
    canvas: HTMLCanvasElement;
    device!: GPUDevice;
    renderer!: Renderer;
    physics!: WebPhysics;

    alive = true;
    isPaused = true;
    frameCount = 0;
    lastTime = performance.now();
    accumulator = 0;
    onFpsUpdate?: (fps: number) => void;
    selectedEntity: Entity | null = null;

    private fpsTimer = 0;
    private fpsFrameCount = 0;
    protected lastObstacleCount = -1;

    params: SimulationParams = {
        dt: 1/60,
        substeps: 8,
        gravity: new Float32Array([0, -9.81]),
        worldBounds: new Float32Array([-BOUNDS.width/2, -BOUNDS.height/2, BOUNDS.width/2, BOUNDS.height/2]),
        collisionIterations: 2,
        isPaused: true
    };

    constructor(container: HTMLElement) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        this.canvas.style.position = 'absolute';
        container.appendChild(this.canvas);
        
        world.onEntityRemoved.subscribe((ent) => {
            if (ent.physicsParticle) this.physics.releaseParticles([ent.physicsParticle.index]);
            if (ent.physicsConstraint?.index !== undefined && ent.physicsConstraint.index !== -1) {
                this.physics.releaseConstraints([ent.physicsConstraint.index]);
            }
        });
    }

    async init() {
        const adapter = await navigator.gpu.requestAdapter();
        this.device = await adapter!.requestDevice();
        
        this.physics = new WebPhysics(this.device);
        await this.physics.init();
        
        this.renderer = new Renderer(this.device, this.canvas);
        await this.renderer.init(this.physics);
        (window as any).engine = this;

        this.animate();
    }

    dispose() {
        this.alive = false;
        this.canvas.remove();
    }

    protected onUpdate() {}

    private syncToGPU() {
        if (!this.physics.ready) return;

        const staticEntities = world.with('staticBody', 'transform', 'sdfCollider');
        const currentCount = staticEntities.entities.length;
        const needsFullObstacleSync = currentCount !== this.lastObstacleCount;
        
        if (needsFullObstacleSync) {
            this.physics.setObstacle(0, new Float32Array([0, 0]), 0, 2, new Float32Array([BOUNDS.width, BOUNDS.height, 0, 0]), 0.1, 7, 0);
            let obsIdx = 1;
            for (const ent of staticEntities) {
                const b = ent.staticBody!;
                this.physics.setObstacle(obsIdx++, ent.transform!.position, ent.transform!.rotation, ent.sdfCollider!.shapeType, ent.sdfCollider!.parameters, b.friction, b.appearance, b.flags);
            }
            this.physics.numObstacles = obsIdx;
            this.lastObstacleCount = currentCount;
        }

        const buildingSegments = new Set<Entity>();
        for (const rope of world.with('physicsRope')) {
            if (rope.tags.includes('building')) {
                for (const seg of rope.physicsRope.segments) buildingSegments.add(seg);
            }
        }

        for (const ent of world.with('physicsBody', 'transform')) {
            if (!ent.physicsParticle) {
                const [idx] = this.physics.allocateParticles(1);
                if (idx !== undefined) {
                    world.addComponent(ent, 'physicsParticle', { index: idx });
                    const b = ent.physicsBody!;
                    this.physics.setParticle(idx, ent.transform.position, ent.transform.position, b.mass, b.friction, ent.sdfCollider?.parameters[0] || 0.5, b.collisionMask, b.appearance, b.flags);
                }
            }
            
            if (ent.physicsParticle) {
                const b = ent.physicsBody!;
                const isSelected = this.selectedEntity === ent;
                const isBuilding = ent.tags?.includes('building') || buildingSegments.has(ent);
                let nextFlags = b.flags;
                if (isSelected) nextFlags |= 1; else nextFlags &= ~1;
                if (isBuilding) nextFlags |= 2; else nextFlags &= ~2;

                if (nextFlags !== b.flags || isBuilding) {
                    b.flags = nextFlags;
                    this.physics.setParticle(ent.physicsParticle.index, ent.transform.position, ent.transform.position, b.mass, b.friction, ent.sdfCollider?.parameters[0] || 0.5, b.collisionMask, b.appearance, b.flags);
                }
            }
        }

        for (const ent of world.with('physicsConstraint')) {
            const c = ent.physicsConstraint;
            if (c.index === undefined || c.index === -1) {
                const [idx] = this.physics.allocateConstraints(1);
                if (idx !== undefined) {
                    c.index = idx;
                    const aIdx = c.targetA.physicsParticle?.index;
                    let bIdx = -1;
                    if (!(c.targetB instanceof Float32Array)) bIdx = (c.targetB as Entity).physicsParticle?.index ?? -1;
                    
                    if (aIdx !== undefined) {
                        c.color = this.physics.assignColor(aIdx, bIdx);
                        const anchor = (c.targetB instanceof Float32Array) ? c.targetB : new Float32Array([0,0]);
                        this.physics.setConstraint(idx, aIdx, bIdx, c.color, c.type, c.restValue, c.stiffness, anchor);
                    }
                }
            }
        }
    }

    private syncFromGPU() {
        for (const ent of world.with('physicsParticle', 'transform')) {
            const off = ent.physicsParticle.index * 8;
            ent.transform.position[0] = this.physics.particles[off]!;
            ent.transform.position[1] = this.physics.particles[off + 1]!;
        }
    }

    animate() {
        if (!this.alive) return;
        requestAnimationFrame(() => this.animate());

        const now = performance.now();
        let frameTime = (now - this.lastTime) / 1000;
        if (frameTime > 0.25) frameTime = 0.25;
        this.lastTime = now;
        this.accumulator += frameTime;

        this.fpsFrameCount++;
        this.fpsTimer += frameTime;
        if (this.fpsTimer >= 1.0) {
            this.onFpsUpdate?.(this.fpsFrameCount);
            this.fpsFrameCount = 0;
            this.fpsTimer -= 1.0;
        }

        this.syncToGPU();
        let steps = 0;
        this.params.isPaused = this.isPaused;
        while (this.accumulator >= this.params.dt && steps < 5) {
            RopeSystem.update(this.physics, (this as any).mouseWorld || new Float32Array([0,0]));
            this.physics.step(this.params);
            this.accumulator -= this.params.dt;
            steps++;
        }
        this.syncFromGPU();
        this.onUpdate();
        this.renderer.render();
    }
}
