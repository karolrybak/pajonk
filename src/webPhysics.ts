import * as THREE from 'three';

const MAX_PARTICLES = 16384;
const MAX_CONSTRAINTS = 16384;

export class WebPhysics {
    renderer: any;
    scene: THREE.Scene;
    bounds: { width: number; height: number };
    ready: boolean = false;
    
    particles = new Float32Array(MAX_PARTICLES * 8);
    distConstraints = new Uint32Array(MAX_CONSTRAINTS * 4);

    numParticles = 0;
    numDistConstraints = 0;
    ropes: any[] = [];
    activeRope: any = null;

    device: GPUDevice | null = null;
    particleBuffer: GPUBuffer | null = null;
    distConstraintBuffer: GPUBuffer | null = null;
    paramsBuffer: GPUBuffer | null = null;
    stagingBuffer: GPUBuffer | null = null;
    bindGroup: GPUBindGroup | null = null;

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

        this.particleBuffer = device.createBuffer({
            size: this.particles.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });

        this.distConstraintBuffer = device.createBuffer({
            size: this.distConstraints.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.paramsBuffer = device.createBuffer({
            size: 64,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.stagingBuffer = device.createBuffer({
            size: this.particles.byteLength,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });

        const bgl = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }
            ]
        });

        this.bindGroup = device.createBindGroup({
            layout: bgl,
            entries: [
                { binding: 0, resource: { buffer: this.particleBuffer } },
                { binding: 1, resource: { buffer: this.distConstraintBuffer } },
                { binding: 2, resource: { buffer: this.paramsBuffer } }
            ]
        });

        const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
        const createPipe = (entry: string) => device.createComputePipeline({ layout, compute: { module: shaderModule, entryPoint: entry } });

        this.pipelines.integrate = createPipe('integrate');
        this.pipelines.solveDistance = createPipe('solveDistance');
        this.pipelines.solveCollisions = createPipe('solveCollisions');

        this.ready = true;
    }

    findAnchor(pos: THREE.Vector2): THREE.Vector2 | null {
        const boxX = 11.8, boxY = 6.8;
        const threshold = 0.5;

        if (Math.abs(pos.x) > boxX - threshold || Math.abs(pos.y) > boxY - threshold) {
            const snapped = pos.clone();
            if (boxX - Math.abs(pos.x) < threshold) snapped.x = Math.sign(pos.x) * boxX;
            if (boxY - Math.abs(pos.y) < threshold) snapped.y = Math.sign(pos.y) * boxY;
            return snapped;
        }

        const circlePos = new THREE.Vector2(4, 2);
        const circleRad = 1.5;
        if (pos.distanceTo(circlePos) < circleRad + threshold) {
            return pos.clone().sub(circlePos).normalize().multiplyScalar(circleRad).add(circlePos);
        }

        for (const rope of this.ropes) {
            if (rope === this.activeRope) continue;
            for (let i = 0; i < rope.segments; i++) {
                const pIdx = rope.indices[i] * 8;
                const ropePos = new THREE.Vector2(this.particles[pIdx], this.particles[pIdx + 1]);
                if (pos.distanceTo(ropePos) < 0.2) return ropePos.clone();
            }
        }

        return null;
    }

    createRope(startPos: THREE.Vector2): any {
        const segments = 120;
        const indices: number[] = [];
        const constraintIndices: number[] = [];
        const restLen = 0.08;

        for (let i = 0; i < segments; i++) {
            const idx = this.numParticles++;
            indices.push(idx);
            const initialPos = startPos.clone().add(new THREE.Vector2(0, -i * 0.01));
            const invMass = (i === 0 || i === segments - 1) ? 0.0 : 1.0;
            this.setParticle(idx, initialPos, invMass);
        }

        for (let i = 0; i < segments - 1; i++) {
            const cIdx = this.numDistConstraints++;
            constraintIndices.push(cIdx);
            this.setDistConstraint(cIdx, indices[i]!, indices[i+1]!, restLen, 0.000001);
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segments * 3), 3));
        
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
        this.scene.add(line);

        const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x00ffff, size: 0.08, sizeAttenuation: true }));
        this.scene.add(points);

        const rope = { indices, constraintIndices, mesh: line, pointsMesh: points, segments, segmentLength: restLen };
        this.ropes.push(rope);
        this.activeRope = rope;
        this.syncGPU();
        return rope;
    }

    setParticle(i: number, pos: THREE.Vector2, invMass: number): void {
        const off = i * 8;
        this.particles[off] = pos.x;
        this.particles[off + 1] = pos.y;
        this.particles[off + 2] = pos.x; 
        this.particles[off + 3] = pos.y;
        this.particles[off + 4] = 0; 
        this.particles[off + 5] = 0; 
        this.particles[off + 6] = invMass;
        this.particles[off + 7] = 0.06;
    }

    setDistConstraint(i: number, a: number, b: number, len: number, compliance: number): void {
        const off = i * 4;
        this.distConstraints[off] = a;
        this.distConstraints[off + 1] = b;
        const fv = new Float32Array(this.distConstraints.buffer, this.distConstraints.byteOffset, this.distConstraints.length);
        fv[off + 2] = len;
        fv[off + 3] = compliance;
    }

    syncGPU(): void {
        if (!this.device || !this.particleBuffer) return;
        this.device.queue.writeBuffer(this.particleBuffer, 0, this.particles);
        this.device.queue.writeBuffer(this.distConstraintBuffer!, 0, this.distConstraints);
    }

    update(mousePos: THREE.Vector2): void {
        if (!this.ready || !this.device || this.isReadingBack) return;

        const substeps = 30;
        const dt = 1.0 / 60.0;

        const paramsBuffer = new ArrayBuffer(64);
        const paramsF32 = new Float32Array(paramsBuffer);
        const paramsU32 = new Uint32Array(paramsBuffer);
        const paramsI32 = new Int32Array(paramsBuffer);

        paramsF32[0] = dt; 
        paramsF32[1] = -22.0; 
        paramsU32[2] = this.numParticles;
        paramsU32[3] = this.numDistConstraints;
        paramsU32[4] = substeps;
        paramsF32[6] = mousePos.x;
        paramsF32[7] = mousePos.y;
        paramsI32[8] = this.activeRope ? this.activeRope.indices[this.activeRope.segments - 1] : -1;

        this.device.queue.writeBuffer(this.paramsBuffer!, 0, paramsBuffer);

        const encoder = this.device.createCommandEncoder();
        for (let s = 0; s < substeps; s++) {
            const pass = encoder.beginComputePass();
            pass.setBindGroup(0, this.bindGroup!);
            pass.setPipeline(this.pipelines.integrate!);
            pass.dispatchWorkgroups(Math.ceil(this.numParticles / 64) || 1);
            pass.setPipeline(this.pipelines.solveDistance!);
            pass.dispatchWorkgroups(Math.ceil(this.numDistConstraints / 64) || 1);
            pass.setPipeline(this.pipelines.solveCollisions!);
            pass.dispatchWorkgroups(Math.ceil(this.numParticles / 64) || 1);
            pass.end();
        }

        encoder.copyBufferToBuffer(this.particleBuffer!, 0, this.stagingBuffer!, 0, this.particles.byteLength);
        this.device.queue.submit([encoder.finish()]);
        
        this.readBackAndVisualize();
    }

    async readBackAndVisualize() {
        if (!this.stagingBuffer || this.isReadingBack) return;
        this.isReadingBack = true;

        try {
            await this.stagingBuffer.mapAsync(GPUMapMode.READ);
            const data = new Float32Array(this.stagingBuffer.getMappedRange());
            this.particles.set(data);
            this.stagingBuffer.unmap();

            for (const rope of this.ropes) {
                const attr = rope.mesh.geometry.getAttribute('position');
                for (let i = 0; i < rope.segments; i++) {
                    const idx = rope.indices[i];
                    attr.setXYZ(i, this.particles[idx * 8]!, this.particles[idx * 8 + 1]!, 0);
                }
                attr.needsUpdate = true;
            }
        } catch (e) {
        } finally {
            this.isReadingBack = false;
        }
    }

    pinActiveRope(rope: any, anchorPos: THREE.Vector2) {
        const lastIdx = rope.indices[rope.segments - 1];
        this.setParticle(lastIdx, anchorPos, 0.0);
        rope.mesh.material.color.set(0x00ffff);
        rope.pointsMesh.material.color.set(0x00ffff);
        this.activeRope = null;
        this.syncGPU();
    }

    adjustRopeLength(rope: any, delta: number) {
        const minLen = 0.01;
        const maxLen = 0.3;
        rope.segmentLength = Math.max(minLen, Math.min(maxLen, rope.segmentLength + delta * 0.01));
        
        for (let i = 0; i < rope.constraintIndices.length; i++) {
            const cIdx = rope.constraintIndices[i];
            this.setDistConstraint(cIdx, rope.indices[i], rope.indices[i+1], rope.segmentLength, 0.000001);
        }
        
        if (this.device && this.distConstraintBuffer) {
            this.device.queue.writeBuffer(this.distConstraintBuffer, 0, this.distConstraints);
        }
    }
}
