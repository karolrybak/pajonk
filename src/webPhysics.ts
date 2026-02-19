import * as THREE from 'three';

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

        const paramsSize = 64;
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

        this.ready = true;
    }

    spawnBall(pos: THREE.Vector2) {
        if (this.numParticles >= MAX_PARTICLES) return;
        const radius = 0.3 + Math.random() * 0.5;
        const idx = this.numParticles++;
        this.setParticle(idx, pos, 0.5 / (radius * radius)); // Mass proportional to area
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
        const segments = 100, restLen = 0.05;
        const indices: number[] = [], constraintIndices: number[] = [];
        for (let i = 0; i < segments; i++) {
            const idx = this.numParticles++;
            indices.push(idx);
            const invMass = (i === 0 && anchor.type !== 'rope') ? 0.0 : 1.0;
            this.setParticle(idx, anchor.pos.clone().add(new THREE.Vector2(0, -i * restLen)), invMass);
        }
        if (anchor.type === 'rope') this.addAttachment(indices[0]!, anchor.aIdx, anchor.bIdx, anchor.t);
        for (let i = 0; i < segments - 1; i++) {
            const cIdx = this.numDistConstraints++;
            constraintIndices.push(cIdx); this.setDistConstraint(cIdx, indices[i]!, indices[i + 1]!, restLen, 0.001);
        }
        const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(segments * 3), 3));
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.8 }));
        const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffaa00, size: 0.08 }));
        this.scene.add(line, pts);
        const rope = { indices, constraintIndices, mesh: line, pointsMesh: pts, segments, segmentLength: restLen };
        this.ropes.push(rope); this.activeRope = rope; this.syncGPU();
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
            const b = new ArrayBuffer(64), f = new Float32Array(b), u = new Uint32Array(b), i = new Int32Array(b);
            f[0] = dt; f[1] = -15.0; u[2] = this.numParticles; u[3] = this.numDistConstraints; u[4] = substeps; u[5] = phase; f[6] = mousePos.x; f[7] = mousePos.y; i[8] = this.activeRope ? this.activeRope.indices[this.activeRope.segments - 1] : -1; u[9] = this.numAttachments;
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

    async readBackAndVisualize() {
        if (!this.stagingBuffer || this.isReadingBack) return;
        this.isReadingBack = true;
        try {
            await this.stagingBuffer.mapAsync(GPUMapMode.READ);
            this.particles.set(new Float32Array(this.stagingBuffer.getMappedRange()));
            this.stagingBuffer.unmap();
            for (const rope of this.ropes) {
                const attr = rope.mesh.geometry.getAttribute('position');
                for (let i = 0; i < rope.segments; i++) attr.setXYZ(i, this.particles[rope.indices[i] * 8]!, this.particles[rope.indices[i] * 8 + 1]!, 0);
                attr.needsUpdate = true;
            }
            for (const ball of this.balls) {
                const px = this.particles[ball.idx * 8], py = this.particles[ball.idx * 8 + 1];
                ball.mesh.position.set(px!, py!, -0.1);
            }
        } catch (e) { } finally { this.isReadingBack = false; }
    }

    pinActiveRope(rope: any, anchor: any) {
        const lastIdx = rope.indices[rope.segments - 1];
        if (anchor.type === 'static') this.setParticle(lastIdx, anchor.pos, 0.0);
        else this.addAttachment(lastIdx, anchor.aIdx, anchor.bIdx, anchor.t);
        rope.mesh.material.color.set(0x00ffff); this.activeRope = null; this.syncGPU();
    }

    adjustRopeLength(rope: any, delta: number) {
        rope.segmentLength = Math.max(0.001, Math.min(0.5, rope.segmentLength - delta * 0.005));
        for (let i = 0; i < rope.constraintIndices.length; i++) this.setDistConstraint(rope.constraintIndices[i], rope.indices[i], rope.indices[i + 1], rope.segmentLength, 0.0);
        this.device?.queue.writeBuffer(this.distConstraintBuffer!, 0, this.distConstraints);
    }
}
