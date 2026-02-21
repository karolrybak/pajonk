import { WebPhysics, type SimulationParams } from '../webPhysics';
import { BOUNDS } from '../constants';
import { world } from '../ecs';
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

    params: SimulationParams = {
        dt: 1/60,
        substeps: 8,
        gravity: new Float32Array([0, -9.81]),
        worldBounds: new Float32Array([-BOUNDS.width/2, -BOUNDS.height/2, BOUNDS.width/2, BOUNDS.height/2]),
        collisionIterations: 4,
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

        this.animate();
    }

    dispose() {
        this.alive = false;
        this.canvas.remove();
    }

    protected onUpdate() {}

    protected systems() {
        if (!this.physics.ready) return;

        // Update static obstacles
        let obsIdx = 0;
        for (const ent of world.with('physicsBody', 'transform', 'sdfCollider')) {
            if (ent.physicsBody.isStatic) {
                this.physics.setObstacle(obsIdx++, ent.transform.position, ent.transform.rotation, ent.sdfCollider.shapeType, ent.sdfCollider.parameters, ent.physicsBody.friction, ent.physicsBody.appearance, ent.physicsBody.flags);
            }
        }
        this.physics.numObstacles = obsIdx;

        // Initial particle/constraint allocation
        for (const ent of world.with('physicsBody', 'transform')) {
            if (!ent.physicsParticle && !ent.physicsBody.isStatic) {
                const [idx] = this.physics.allocateParticles(1);
                if (idx !== undefined) {
                    world.addComponent(ent, 'physicsParticle', { index: idx });
                    const b = ent.physicsBody;
                    this.physics.setParticle(idx, ent.transform.position, ent.transform.position, b.mass, b.friction, ent.sdfCollider?.parameters[0] || 0.5, b.collisionMask, b.appearance, b.flags);
                }
            }
        }

        for (const ent of world.with('physicsConstraint')) {
            if (ent.physicsConstraint.index === undefined || ent.physicsConstraint.index === -1) {
                const [idx] = this.physics.allocateConstraints(1);
                if (idx !== undefined) {
                    ent.physicsConstraint.index = idx;
                    const c = ent.physicsConstraint;
                    const aIdx = c.targetA.physicsParticle?.index;
                    let bIdx = -1;
                    let anchor = new Float32Array([0, 0]);
                    if (!(c.targetB instanceof Float32Array)) {
                        bIdx = c.targetB.physicsParticle?.index ?? -1;
                    } else {
                        anchor = c.targetB;
                    }
                    if (aIdx !== undefined) {
                        this.physics.setConstraint(idx, aIdx, bIdx, -1, c.type, c.restValue, c.stiffness, anchor);
                    }
                }
            }
        }

        // Runtime selection/building state sync
        for (const ent of world.with('physicsParticle', 'physicsBody')) {
            const b = ent.physicsBody;
            const isSelected = (this as any).selectedEntityId === ent.id;
            const isBuilding = ent.tags?.includes('building') || world.entities.some(e => e.physicsRope?.segments.includes(ent) && e.tags.includes('building'));
            
            let flags = b.flags;
            if (isSelected) flags |= 1; else flags &= ~1;
            if (isBuilding) flags |= 2; else flags &= ~2; // SIM_ALWAYS_FLAG

            if (flags !== b.flags) {
                b.flags = flags;
                this.physics.setParticle(ent.physicsParticle.index, ent.transform!.position, ent.transform!.position, b.mass, b.friction, ent.sdfCollider?.parameters[0] || 0.5, b.collisionMask, b.appearance, b.flags);
            }
        }

        this.params.isPaused = this.isPaused;
        this.physics.step(this.params);

        // CPU position sync for Editor/Logic
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

        this.frameCount++;
        if (this.accumulator >= 1.0) {
            this.onFpsUpdate?.(this.frameCount);
            this.frameCount = 0;
        }

        while (this.accumulator >= this.params.dt) {
            RopeSystem.update(this.physics, (this as any).mouseWorld || new Float32Array([0,0]));
            this.systems();
            this.accumulator -= this.params.dt;
        }

        this.onUpdate();
        this.renderer.render();
    }
}