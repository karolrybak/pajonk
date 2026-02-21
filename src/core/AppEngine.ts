import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { WebPhysics } from '../webPhysics';
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
        
        this.physics = new WebPhysics(this.renderer, this.scene, BOUNDS);
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
        this.clearScene();
    }

    clearScene() {
        [...world.entities].forEach(ent => {
            if (ent.renderable) this.scene.remove(ent.renderable.mesh);
            if (ent.physics?.particleIdx !== undefined) this.physics.freeParticle(ent.physics.particleIdx);
            world.remove(ent);
        });

        for (const rope of this.physics.ropes) {
            rope.indices.forEach((i: number) => this.physics.freeParticle(i));
            rope.constraintIndices.forEach((i: number) => this.physics.freeConstraint(i));
            rope.anchorConstraints.forEach((i: number) => this.physics.freeConstraint(i));
        }

        this.physics.ropes = [];
        this.physics.numParticles = 0;
        this.physics.numDistConstraints = 0;
        this.physics.numAttachments = 0;
        this.physics.numObstacles = 0;
        this.physics.freeParticleIndices = [];
        this.physics.freeConstraintIndices = [];
        this.physics.particleActive.fill(0);
        this.physics.constraintVisible.fill(0);
        this.physics.particleColors.forEach(s => s.clear());
        this.physics.colorCounts.fill(0);
        this.physics.maxColor = 0;

        this.physics.syncGPU();
        this.physics.updateVisuals();
    }

    protected onUpdate() {}

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

        if (this.physics.ready) {
            this.physics.syncObstacles();
            this.physics.update(new THREE.Vector2()); // Base engine doesn't track mouse
        }
        this.renderer.render(this.scene, this.camera);
    }
}