import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { WebPhysics, type SimulationParams } from '../webPhysics';
import { BOUNDS } from '../constants';
import { world } from '../ecs';

export class AppEngine {
    canvas: HTMLElement;
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    renderer: WebGPURenderer;
    physics: WebPhysics;

    alive = true;
    frameCount = 0;
    lastTime = performance.now();
    onFpsUpdate?: (fps: number) => void;

    params: SimulationParams = {
        dt: 1/60,
        substeps: 8,
        gravity: new THREE.Vector2(0, -9.81),
        worldBounds: new THREE.Vector4(-BOUNDS.width/2, -BOUNDS.height/2, BOUNDS.width/2, BOUNDS.height/2),
        collisionIterations: 1
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
                this.physics.setObstacle(obsIdx++, ent.transform.position, ent.transform.rotation, ent.sdfCollider.shapeType, ent.sdfCollider.parameters, ent.physicsBody.friction);
            }
        }
        this.physics.numObstacles = obsIdx;

        for (const ent of world.with('physicsBody', 'transform')) {
            if (!ent.physicsParticle && !ent.physicsBody.isStatic) {
                const [idx] = this.physics.allocateParticles(1);
                if (idx !== undefined) {
                    world.addComponent(ent, 'physicsParticle', { index: idx });
                    this.physics.setParticle(idx, ent.transform.position, ent.transform.position, ent.physicsBody.mass, ent.physicsBody.friction, ent.sdfCollider?.parameters[0] || 0.5, ent.physicsBody.collisionMask);
                }
            }
        }

        this.physics.step(this.params);

        for (const ent of world.with('physicsParticle', 'transform')) {
            const off = ent.physicsParticle.index * 8;
            ent.transform.position.set(this.physics.particles[off], this.physics.particles[off + 1]);
        }

        for (const ent of world.with('transform', 'renderable')) {
            ent.renderable.mesh.position.set(ent.transform.position.x, ent.transform.position.y, ent.renderable.mesh.position.z);
            ent.renderable.mesh.rotation.z = ent.transform.rotation;
        }
    }

    animate() {
        if (!this.alive) return;
        requestAnimationFrame(this.animate);

        const now = performance.now();
        this.frameCount++;
        if (now - this.lastTime >= 1000) {
            this.onFpsUpdate?.(this.frameCount);
            this.frameCount = 0;
            this.lastTime = now;
        }

        this.onUpdate();
        this.systems();
        
        this.renderer.render(this.scene, this.camera);
    }
}
