import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { WebPhysics, type SimulationParams } from '../webPhysics';
import { BOUNDS } from '../constants';
import { world } from '../ecs';
import { MAX_CONSTRAINTS } from '../webPhysics';
import { RopeSystem } from './RopeSystem';

export class AppEngine {
    canvas: HTMLElement;
    scene: THREE.Scene;
    constraintLines: THREE.LineSegments;
    camera: THREE.OrthographicCamera;
    renderer: WebGPURenderer;
    physics: WebPhysics;

    alive = true;
    frameCount = 0;
    lastTime = performance.now();
    accumulator = 0;
    onFpsUpdate?: (fps: number) => void;

    params: SimulationParams = {
        dt: 1/60,
        substeps: 8,
        gravity: new THREE.Vector2(0, -9.81),
        worldBounds: new THREE.Vector4(-BOUNDS.width/2, -BOUNDS.height/2, BOUNDS.width/2, BOUNDS.height/2),
        collisionIterations: 4
    };

    constructor(canvas: HTMLElement) {
        this.canvas = canvas;
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-BOUNDS.width/2, BOUNDS.width/2, BOUNDS.height/2, -BOUNDS.height/2, 0.1, 1000);
        this.camera.position.z = 10;
        
        this.renderer = new WebGPURenderer({ antialias: true });
        this.renderer.domElement.style.position = 'absolute';
        this.renderer.domElement.style.top = '0';
        this.renderer.domElement.style.left = '0';
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        canvas.appendChild(this.renderer.domElement);
        
        this.physics = new WebPhysics(this.renderer, this.scene);
        
        world.onEntityRemoved.subscribe((ent) => {
            if (ent.physicsParticle) this.physics.releaseParticles([ent.physicsParticle.index]);
            if (ent.physicsConstraint?.index !== undefined) this.physics.releaseConstraints([ent.physicsConstraint.index]);
        });

        this.constraintLines = new THREE.LineSegments(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({ color: 0x00ffff, depthTest: false })
        );
        this.constraintLines.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_CONSTRAINTS * 18), 3));
        this.scene.add(this.constraintLines);

        this.animate = this.animate.bind(this);
    }

    async init() {
        await this.renderer.init();
        await this.physics.init();
        this.animate();
    }

    dispose() {
        this.alive = false;
        if (this.renderer.domElement.parentNode) {
            this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
    }

    protected onUpdate() {}

    protected systems() {
        if (!this.physics.ready) return;

        let obsIdx = 0;
        for (const ent of world.with('physicsBody', 'transform', 'sdfCollider')) {
            if (ent.physicsBody.isStatic) {
                this.physics.setObstacle(obsIdx++, ent.transform.position, ent.transform.rotation, ent.sdfCollider.shapeType, ent.sdfCollider.parameters, ent.physicsBody.friction, ent.physicsBody.appearance, ent.physicsBody.flags);
            }
        }
        this.physics.numObstacles = obsIdx;

        const idToParticle = new Map<string, number>();

        for (const ent of world.with('physicsBody', 'transform')) {
            if (!ent.physicsParticle && !ent.physicsBody.isStatic) {
                const [idx] = this.physics.allocateParticles(1);
                if (idx !== undefined) {
                    world.addComponent(ent, 'physicsParticle', { index: idx });
                    this.physics.setParticle(idx, ent.transform.position, ent.transform.position, ent.physicsBody.mass, ent.physicsBody.friction, ent.sdfCollider?.parameters[0] || 0.5, ent.physicsBody.collisionMask, ent.physicsBody.appearance, ent.physicsBody.flags);
                }
            }
            if (ent.physicsParticle) {
                idToParticle.set(ent.id, ent.physicsParticle.index);
            }
        }

        for (const ent of world.with('physicsConstraint')) {
            if (ent.physicsConstraint.index === undefined) {
                const [idx] = this.physics.allocateConstraints(1);
                if (idx !== undefined) ent.physicsConstraint.index = idx;
            }
            if (ent.physicsConstraint.index !== undefined) {
                const c = ent.physicsConstraint;
                const aIdx = idToParticle.get(c.targetA);
                let bIdx = -1;
                let cIdx = -1;
                let anchor = new THREE.Vector2();
                
                if (typeof c.targetB === 'string') {
                    bIdx = idToParticle.get(c.targetB) ?? -1;
                } else {
                    anchor = c.targetB;
                }
                if (c.targetC) {
                    cIdx = idToParticle.get(c.targetC) ?? -1;
                }

                if (aIdx !== undefined && (bIdx !== -1 || typeof c.targetB !== 'string')) {
                    this.physics.setConstraint(c.index, aIdx, bIdx, cIdx, c.type, c.restValue, c.stiffness, anchor);
                }
            }
        }

        // Apply ECS forces to GPU
        for (const ent of world.with('physicsParticle', 'force')) {
            if (ent.force.x !== 0 || ent.force.y !== 0) {
                this.physics.addForce(ent.physicsParticle.index, ent.force.x, ent.force.y);
                ent.force.set(0, 0);
            }
        }

        this.physics.step(this.params);

        // Sync GPU positions and velocity back to ECS
        for (const ent of world.with('physicsParticle', 'transform')) {
            const off = ent.physicsParticle.index * 8;
            const px = this.physics.particles[off];
            const py = this.physics.particles[off + 1];
            const ppx = this.physics.particles[off + 2];
            const ppy = this.physics.particles[off + 3];
            
            ent.transform.position.set(px, py);
            
            if (!ent.velocity) ent.velocity = new THREE.Vector2();
            ent.velocity.set(px - ppx, py - ppy);
        }

        for (const ent of world.with('transform', 'renderable')) {
            ent.renderable.mesh.position.set(ent.transform.position.x, ent.transform.position.y, ent.renderable.mesh.position.z);
            ent.renderable.mesh.rotation.z = ent.transform.rotation;
        }

        let drawCount = 0;
        const posAttr = this.constraintLines.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (const ent of world.with('physicsConstraint')) {
            if (ent.physicsConstraint.index !== undefined) {
                const c = ent.physicsConstraint;
                const aIdx = idToParticle.get(c.targetA);
                if (aIdx === undefined) continue;
                
                const pA = new THREE.Vector2(this.physics.particles[aIdx * 8], this.physics.particles[aIdx * 8 + 1]);
                const pB = new THREE.Vector2();
                const pC = new THREE.Vector2();
                
                if (typeof c.targetB === 'string') {
                    const bIdx = idToParticle.get(c.targetB);
                    if (bIdx === undefined) continue;
                    pB.set(this.physics.particles[bIdx * 8], this.physics.particles[bIdx * 8 + 1]);
                } else {
                    pB.copy(c.targetB);
                }

                const drawLine = (p1: THREE.Vector2, p2: THREE.Vector2) => {
                    posAttr.setXYZ(drawCount * 2, p1.x, p1.y, 0);
                    posAttr.setXYZ(drawCount * 2 + 1, p2.x, p2.y, 0);
                    drawCount++;
                };

                if (c.type === 0 || c.type === 3 || c.type === 4) {
                    drawLine(pA, pB);
                } else if (c.type === 1) { // Angular (A-B, B-C)
                    const cIdx = idToParticle.get(c.targetC!);
                    if (cIdx !== undefined) {
                        pC.set(this.physics.particles[cIdx * 8], this.physics.particles[cIdx * 8 + 1]);
                        drawLine(pA, pB);
                        drawLine(pB, pC);
                    }
                } else if (c.type === 2) { // Area (A-B, B-C, C-A)
                    const cIdx = idToParticle.get(c.targetC!);
                    if (cIdx !== undefined) {
                        pC.set(this.physics.particles[cIdx * 8], this.physics.particles[cIdx * 8 + 1]);
                        drawLine(pA, pB);
                        drawLine(pB, pC);
                        drawLine(pC, pA);
                    }
                }
            }
        }
        this.constraintLines.geometry.setDrawRange(0, drawCount * 2);
        posAttr.needsUpdate = true;
    }

    animate() {
        if (!this.alive) return;
        requestAnimationFrame(this.animate);

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
            this.fixedUpdate();
            this.accumulator -= this.params.dt;
        }

        this.onUpdate();
        this.visualSync();
        this.renderer.render(this.scene, this.camera);
    }

    protected fixedUpdate() {
        RopeSystem.update((this as any).mouseWorld || new THREE.Vector2());
        this.systems();
    }

    protected visualSync() {
        for (const ent of world.with('transform', 'renderable')) {
            ent.renderable.mesh.position.set(ent.transform.position.x, ent.transform.position.y, ent.renderable.mesh.position.z || 0);
            ent.renderable.mesh.rotation.z = ent.transform.rotation;
        }
    }
}
