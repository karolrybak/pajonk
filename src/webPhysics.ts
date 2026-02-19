import * as THREE from 'three';

// Physics Configuration
export const CONFIG = {
    SEGMENT_LENGTH: 0.1,        // Długość spoczynkowa pojedynczego segmentu liny [m]
    ROPE_NODE_MASS: 0.1,        // Masa pojedynczego węzła liny [kg]
    ROPE_COMPLIANCE: 0.00001,   // Podatność wiązań (0 = idealnie sztywna, >0 = elastyczna)
    VELOCITY_DAMPING: 0.992,    // Tłumienie prędkości (0.9-0.999) - symulacja oporu powietrza
    GRAVITY: -15.0,             // Przyspieszenie grawitacyjne (oś Y) [m/s^2]
    PENDULUM_RADIUS: 1.2,       // Promień ruchomej kuli [m]
    PENDULUM_LENGTH: 4.0        // Długość ramienia wahadła [m]
};

const MAX_PARTICLES = 16384;
const MAX_CONSTRAINTS = 16384;
const MAX_ATTACHMENTS = 4096;

export class WebPhysics {
    renderer: any;
    scene: THREE.Scene;
    bounds: { width: number; height: number };
    ready: boolean = false;

    particles = new Float32Array(MAX_PARTICLES * 8);
    distConstraints = new Float32Array(MAX_CONSTRAINTS * 4);
    attachments = new Float32Array(MAX_ATTACHMENTS * 4);

    numParticles = 0;
    numDistConstraints = 0;
    numAttachments = 0;
    ropes: any[] = [];
    balls: any[] = [];
    activeRope: any = null;
    pendulum: any = null;

    dirtyParticles: Set<number> = new Set();
    freeParticleIndices: number[] = [];
    freeConstraintIndices: number[] = [];

    device: GPUDevice | null = null;
    particleBuffer: GPUBuffer | null = null;
    distConstraintBuffer: GPUBuffer | null = null;
    attachmentBuffer: GPUBuffer | null = null;
    paramsBuffer0: GPUBuffer | null = null;
    paramsBuffer1: GPUBuffer | null = null;
    stagingBuffer: GPUBuffer | null = null;
    bindGroup0: GPUBindGroup | null = null;
    bindGroup1: GPUBindGroup | null = null;

    pipelines: Record<string, GPUComputePipeline> = {};
    isReadingBack = false;

    constructor(renderer: any, scene: THREE.Scene, bounds: { width: number; height: number }) {
        this.renderer = renderer;
        this.scene = scene;
        this.bounds = bounds;
    }

    async init(): Promise<void> {
        const device = this.renderer.device || this.renderer.backend?.device;
        if (!device) throw new Error('WebGPU device not found');
        this.device = device;

        const shaderCode = await (await fetch('/src/physics.wgsl')).text();
        const shaderModule = device.createShaderModule({ code: shaderCode });

        this.particleBuffer = device.createBuffer({ size: this.particles.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
        this.distConstraintBuffer = device.createBuffer({ size: this.distConstraints.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.attachmentBuffer = device.createBuffer({ size: this.attachments.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

        const paramsSize = 80;
        this.paramsBuffer0 = device.createBuffer({ size: paramsSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.paramsBuffer1 = device.createBuffer({ size: paramsSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

        this.stagingBuffer = device.createBuffer({ size: this.particles.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

        const bgl = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }
            ]
        });

        const createBG = (pBuf: GPUBuffer) => device.createBindGroup({
            layout: bgl,
            entries: [
                { binding: 0, resource: { buffer: this.particleBuffer! } },
                { binding: 1, resource: { buffer: this.distConstraintBuffer! } },
                { binding: 2, resource: { buffer: this.attachmentBuffer! } },
                { binding: 3, resource: { buffer: pBuf } }
            ]
        });

        this.bindGroup0 = createBG(this.paramsBuffer0!);
        this.bindGroup1 = createBG(this.paramsBuffer1!);

        const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
        const createPipe = (entry: string) => device.createComputePipeline({ layout, compute: { module: shaderModule, entryPoint: entry } });

        this.pipelines.integrate = createPipe('integrate');
        this.pipelines.solveDistance = createPipe('solveDistance');
        this.pipelines.solveAttachments = createPipe('solveAttachments');
        this.pipelines.solveParticleCollisions = createPipe('solveParticleCollisions');
        this.pipelines.solveCollisions = createPipe('solveCollisions');

        this.setupPendulum();
        this.ready = true;
    }

    setupPendulum() {
        const pivotIdx = this.allocParticle();
        const ballIdx = this.allocParticle();
        const pivotPos = new THREE.Vector2(-6, 4);
        const ballPos = pivotPos.clone().add(new THREE.Vector2(CONFIG.PENDULUM_LENGTH, 0));

        this.setParticle(pivotIdx, pivotPos, 0.0); // Static pivot
        this.setParticle(ballIdx, ballPos, 0.2); // Heavy ball (invMass 0.2 = 5kg)
        this.particles[ballIdx * 8 + 7] = CONFIG.PENDULUM_RADIUS;

        const cIdx = this.allocConstraint();
        this.setDistConstraint(cIdx, pivotIdx, ballIdx, CONFIG.PENDULUM_LENGTH, 0.0);

        const geo = new THREE.CircleGeometry(CONFIG.PENDULUM_RADIUS, 32);
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x5555ff }));
        const armGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const arm = new THREE.Line(armGeo, new THREE.LineBasicMaterial({ color: 0x444444 }));
        
        this.scene.add(mesh, arm);
        this.pendulum = { pivotIdx, ballIdx, mesh, arm };
        this.syncGPU();
    }

    allocParticle(): number {
        if (this.freeParticleIndices.length > 0) return this.freeParticleIndices.pop()!;
        if (this.numParticles >= MAX_PARTICLES) return -1;
        return this.numParticles++;
    }

    freeParticle(idx: number) {
        this.freeParticleIndices.push(idx);
        // Move to 0,0 and make static to stop processing in shader (mostly)
        this.setParticle(idx, new THREE.Vector2(0, 0), 0.0);
    }

    allocConstraint(): number {
        if (this.freeConstraintIndices.length > 0) return this.freeConstraintIndices.pop()!;
        if (this.numDistConstraints >= MAX_CONSTRAINTS) return -1;
        return this.numDistConstraints++;
    }

    freeConstraint(idx: number) {
        this.freeConstraintIndices.push(idx);
        this.setDistConstraint(idx, 0, 0, 0, 0);
    }

    spawnBall(pos: THREE.Vector2) {
        const idx = this.allocParticle();
        if (idx === -1) return;

        const radius = 0.3 + Math.random() * 0.5;
        this.setParticle(idx, pos, 0.5 / (radius * radius));
        this.particles[idx * 8 + 7] = radius;

        const geo = new THREE.CircleGeometry(radius, 16);
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.9 }));
        this.scene.add(mesh);
        this.balls.push({ idx, mesh });
        this.syncGPU();
    }

    findAnchor(pos: THREE.Vector2): any | null {
        const bx = 11.8, by = 6.8, threshold = 0.5;
        if (Math.abs(pos.x) > bx - threshold || Math.abs(pos.y) > by - threshold) {
            const snapped = pos.clone();
            if (bx - Math.abs(pos.x) < threshold) snapped.x = Math.sign(pos.x) * bx;
            if (by - Math.abs(pos.y) < threshold) snapped.y = Math.sign(pos.y) * by;
            return { pos: snapped, type: 'static' };
        }
        const circlePos = new THREE.Vector2(4, 2);
        if (pos.distanceTo(circlePos) < 1.5 + threshold) {
            return { pos: pos.clone().sub(circlePos).normalize().multiplyScalar(1.5).add(circlePos), type: 'static' };
        }
        if (this.pendulum) {
            const pPos = this.getParticlePos(this.pendulum.ballIdx);
            if (pos.distanceTo(pPos) < CONFIG.PENDULUM_RADIUS + threshold) {
                return { pos: pos.clone().sub(pPos).normalize().multiplyScalar(CONFIG.PENDULUM_RADIUS).add(pPos), type: 'static' };
            }
        }
        for (const rope of this.ropes) {
            if (rope === this.activeRope) continue;
            for (let i = 0; i < rope.segments - 1; i++) {
                const p1 = this.getParticlePos(rope.indices[i]!);
                const p2 = this.getParticlePos(rope.indices[i + 1]!);
                const line = p2.clone().sub(p1), lenSq = line.lengthSq();
                const t = Math.max(0, Math.min(1, pos.clone().sub(p1).dot(line) / lenSq));
                const proj = p1.clone().add(line.multiplyScalar(t));
                if (pos.distanceTo(proj) < 0.25) return { pos: proj, type: 'rope', aIdx: rope.indices[i], bIdx: rope.indices[i + 1], t };
            }
        }
        return null;
    }

    getParticlePos(i: number) { return new THREE.Vector2(this.particles[i * 8], this.particles[i * 8 + 1]); }

    createRope(anchor: any): any {
        // Start with just 2 particles: Anchor -> Mouse
        const segmentLength = CONFIG.SEGMENT_LENGTH;
        const indices: number[] = [];
        const constraintIndices: number[] = [];
        
        // 1. Anchor Particle
        const idxA = this.allocParticle();
        indices.push(idxA);
        const invMassA = (anchor.type !== 'rope') ? 0.0 : (1.0 / CONFIG.ROPE_NODE_MASS);
        this.setParticle(idxA, anchor.pos, invMassA);

        // 2. Mouse/Tail Particle
        const idxB = this.allocParticle();
        indices.push(idxB);
        this.setParticle(idxB, anchor.pos, 1.0 / CONFIG.ROPE_NODE_MASS);

        // Attachment if needed
        if (anchor.type === 'rope') this.addAttachment(idxA, anchor.aIdx, anchor.bIdx, anchor.t);

        // Constraint between them
        const cIdx = this.allocConstraint();
        constraintIndices.push(cIdx);
        this.setDistConstraint(cIdx, idxA, idxB, segmentLength, CONFIG.ROPE_COMPLIANCE);

        // Mesh (allocate max size upfront to avoid constant recreation)
        const maxSegments = 200;
        const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxSegments * 3), 3));
        // Initialize geo to hide unused segments
        geo.setDrawRange(0, 2);

        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.8 }));
        const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffaa00, size: 0.08 }));
        
        this.scene.add(line, pts);
        
        const rope = {
            indices,
            constraintIndices,
            mesh: line,
            pointsMesh: pts,
            segments: 1,
            segmentLength: segmentLength
        };
        
        this.ropes.push(rope);
        this.activeRope = rope;
        this.syncGPU();
        return rope;
    }

    addAttachment(pIdx: number, aIdx: number, bIdx: number, t: number) {
        const off = this.numAttachments * 4, uv = new Uint32Array(this.attachments.buffer);
        uv[off] = pIdx; uv[off + 1] = aIdx; uv[off + 2] = bIdx; this.attachments[off + 3] = t;
        this.numAttachments++; this.particles[pIdx * 8 + 6] = 1.0;
    }

    setParticle(i: number, pos: THREE.Vector2, invMass: number): void {
        const off = i * 8;
        this.particles[off] = pos.x; this.particles[off + 1] = pos.y;
        this.particles[off + 2] = pos.x; this.particles[off + 3] = pos.y;
        this.particles[off + 4] = 0; this.particles[off + 5] = 0;
        this.particles[off + 6] = invMass; this.particles[off + 7] = 0.04;
        this.dirtyParticles.add(i);
    }

    setDistConstraint(i: number, a: number, b: number, len: number, comp: number): void {
        const off = i * 4, uv = new Uint32Array(this.distConstraints.buffer);
        uv[off] = a; uv[off + 1] = b; this.distConstraints[off + 2] = len; this.distConstraints[off + 3] = comp;
    }

    syncGPU(): void {
        this.device?.queue.writeBuffer(this.particleBuffer!, 0, this.particles);
        this.device?.queue.writeBuffer(this.distConstraintBuffer!, 0, this.distConstraints);
        this.device?.queue.writeBuffer(this.attachmentBuffer!, 0, this.attachments);
    }

    update(mousePos: THREE.Vector2): void {
        if (!this.ready || this.isReadingBack) return;



        const substeps = 12, constraintIters = 6, dt = 1.0 / 60.0;
        const fill = (phase: number) => {
            const b = new ArrayBuffer(80), f = new Float32Array(b), u = new Uint32Array(b), i = new Int32Array(b);
            f[0] = dt; 
            f[1] = CONFIG.GRAVITY; 
            u[2] = this.numParticles; 
            u[3] = this.numDistConstraints; 
            u[4] = substeps; 
            u[5] = phase; 
            f[6] = mousePos.x; 
            f[7] = mousePos.y;
            i[8] = this.activeRope ? this.activeRope.indices[this.activeRope.indices.length - 1] : -1;
            u[9] = this.numAttachments;
            f[10] = CONFIG.VELOCITY_DAMPING;
            i[11] = this.pendulum ? this.pendulum.ballIdx : -1;
            return b;
        };
        this.device?.queue.writeBuffer(this.paramsBuffer0!, 0, fill(0));
        this.device?.queue.writeBuffer(this.paramsBuffer1!, 0, fill(1));

        const encoder = this.device!.createCommandEncoder();
        for (let s = 0; s < substeps; s++) {
            const intPass = encoder.beginComputePass();
            intPass.setBindGroup(0, this.bindGroup0!); intPass.setPipeline(this.pipelines.integrate!); intPass.dispatchWorkgroups(Math.ceil(this.numParticles / 64) || 1); intPass.end();

            for (let i = 0; i < constraintIters; i++) {
                const p0 = encoder.beginComputePass(); p0.setBindGroup(0, this.bindGroup0!); p0.setPipeline(this.pipelines.solveDistance!); p0.dispatchWorkgroups(Math.ceil(this.numDistConstraints / 64) || 1); p0.end();
                const p1 = encoder.beginComputePass(); p1.setBindGroup(0, this.bindGroup1!); p1.setPipeline(this.pipelines.solveDistance!); p1.dispatchWorkgroups(Math.ceil(this.numDistConstraints / 64) || 1); p1.end();
                const ap = encoder.beginComputePass(); ap.setBindGroup(0, this.bindGroup0!); ap.setPipeline(this.pipelines.solveAttachments!); ap.dispatchWorkgroups(Math.ceil(this.numAttachments / 64) || 1); ap.end();
            }
            // Solve Inter-particle collisions (Balls vs Ropes, Balls vs Balls)
            const ppCol = encoder.beginComputePass(); ppCol.setBindGroup(0, this.bindGroup0!); ppCol.setPipeline(this.pipelines.solveParticleCollisions!); ppCol.dispatchWorkgroups(Math.ceil(this.numParticles / 64) || 1); ppCol.end();

            const col = encoder.beginComputePass(); col.setBindGroup(0, this.bindGroup0!); col.setPipeline(this.pipelines.solveCollisions!); col.dispatchWorkgroups(Math.ceil(this.numParticles / 64) || 1); col.end();
        }
        encoder.copyBufferToBuffer(this.particleBuffer!, 0, this.stagingBuffer!, 0, this.particles.byteLength);
        this.device?.queue.submit([encoder.finish()]);
        this.readBackAndVisualize();
    }

    readBackAndVisualize() {
        if (!this.stagingBuffer || this.isReadingBack) return;
        this.isReadingBack = true;

        this.stagingBuffer.mapAsync(GPUMapMode.READ).then(() => {
            const range = this.stagingBuffer!.getMappedRange();
            const gpuData = new Float32Array(range);
            
            // Backup dirty particles (CPU is authoritative for initialization)
            const backups: {i: number, data: Float32Array}[] = [];
            this.dirtyParticles.forEach(i => {
                backups.push({ i, data: this.particles.slice(i*8, i*8+8) });
            });

            this.particles.set(gpuData);

            // Restore backups
            for(const b of backups) {
                this.particles.set(b.data, b.i*8);
            }
            this.dirtyParticles.clear();

            this.stagingBuffer!.unmap();
            this.isReadingBack = false;
            this.updateVisuals();
        }).catch(() => {
            this.isReadingBack = false;
        });
    }

    updateVisuals() {
        for (const rope of this.ropes) {
            const attr = rope.mesh.geometry.getAttribute('position');
            // Update draw range to match current topology
            rope.mesh.geometry.setDrawRange(0, rope.indices.length);
            if (rope.pointsMesh) rope.pointsMesh.geometry.setDrawRange(0, rope.indices.length);

            for (let i = 0; i < rope.indices.length; i++) {
                const idx = rope.indices[i];
                attr.setXYZ(i, this.particles[idx * 8]!, this.particles[idx * 8 + 1]!, 0);
            }
            attr.needsUpdate = true;
        }
        for (const ball of this.balls) {
            const px = this.particles[ball.idx * 8], py = this.particles[ball.idx * 8 + 1];
            ball.mesh.position.set(px!, py!, -0.1);
        }
    }

    pinActiveRope(rope: any, anchor: any) {
        const lastIdx = rope.indices[rope.indices.length - 1];
        // Fix the last particle position to the anchor
        this.setParticle(lastIdx, anchor.pos, anchor.type === 'static' ? 0.0 : (1.0 / CONFIG.ROPE_NODE_MASS));
        if (anchor.type !== 'static') this.addAttachment(lastIdx, anchor.aIdx, anchor.bIdx, anchor.t);
        
        // Finalize rope state
        rope.mesh.material.color.set(0x00ffff);
        this.activeRope = null;
        this.syncGPU();
    }



    adjustRopeLength(rope: any, delta: number) {
        const SEG_LEN = rope.segmentLength;
        if (delta < 0) { // Scroll Up -> Add Segment
             if (rope.indices.length >= 200) return;

             const tailIdx = rope.indices[rope.indices.length - 1];
             const prevIdx = rope.indices[rope.indices.length - 2];
             
             const prevPos = new THREE.Vector2(this.particles[prevIdx * 8], this.particles[prevIdx * 8 + 1]);
             const tailPos = new THREE.Vector2(this.particles[tailIdx * 8], this.particles[tailIdx * 8 + 1]);

             const dir = tailPos.clone().sub(prevPos);
             if (dir.lengthSq() < 0.0001) dir.set(1, 0);
             else dir.normalize();

             const newPos = prevPos.clone().add(dir.multiplyScalar(SEG_LEN));
             
             const newIdx = this.allocParticle();
             if (newIdx === -1) return;
             this.setParticle(newIdx, newPos, 1.0);

             const lastCIdx = rope.constraintIndices[rope.constraintIndices.length - 1];
             this.setDistConstraint(lastCIdx, prevIdx, newIdx, SEG_LEN, CONFIG.ROPE_COMPLIANCE);
             
             const newCIdx = this.allocConstraint();
             if (newCIdx !== -1) {
                rope.constraintIndices.push(newCIdx);
                this.setDistConstraint(newCIdx, newIdx, tailIdx, SEG_LEN, CONFIG.ROPE_COMPLIANCE);
             }

             rope.indices.pop();
             rope.indices.push(newIdx);
             rope.indices.push(tailIdx);
             rope.segments++;
             
             this.syncGPU();
        } 
        else if (delta > 0) { // Scroll Down -> Remove Segment
            if (rope.indices.length <= 2) return;

            const tailIdx = rope.indices.pop(); 
            const removedIdx = rope.indices.pop();
            rope.indices.push(tailIdx);
            
            // Recycle the particle
            if (removedIdx !== undefined) this.freeParticle(removedIdx);
            
            const removedCIdx = rope.constraintIndices.pop();
            if (removedCIdx !== undefined) this.freeConstraint(removedCIdx);
            
            const lastCIdx = rope.constraintIndices[rope.constraintIndices.length - 1];
            const newLastNodeIdx = rope.indices[rope.indices.length - 2];
            
            this.setDistConstraint(lastCIdx, newLastNodeIdx, tailIdx, SEG_LEN, CONFIG.ROPE_COMPLIANCE);
            
            rope.segments--;
            this.syncGPU();
        }
    }
}
