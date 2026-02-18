import * as THREE from 'three';

const MAX_PARTICLES = 2048;
const MAX_CONSTRAINTS = 2048;

export class WebPhysics {
    renderer: any;
    scene: THREE.Scene;
    bounds: { width: number; height: number };
    ready: boolean = false;
    
    // Float32Array where each particle is 8 floats (32 bytes)
    particles = new Float32Array(MAX_PARTICLES * 8);
    // Uint32Array where each constraint is 4 uints/floats (16 bytes)
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

        // Clear buffer initially
        device.queue.writeBuffer(this.particleBuffer, 0, this.particles);

        this.ready = true;
    }

    createRope(startPos: THREE.Vector2): any {
        if (this.numParticles + 25 > MAX_PARTICLES) return null;

        const segments = 20;
        const indices: number[] = [];
        const constraintIndices: number[] = [];
        const initialSegLen = 0.2; 

        for (let i = 0; i < segments; i++) {
            const idx = this.numParticles++;
            indices.push(idx);
            // Vertical initialization
            const pos = new THREE.Vector2(startPos.x, startPos.y - i * initialSegLen);
            // Pin only the start initially, end is controlled by mouse via activeParticleIdx
            const isFixed = (i === 0);
            this.setParticle(idx, pos, isFixed ? 0.0 : 1.0);
        }

        for (let i = 0; i < segments - 1; i++) {
            const cIdx = this.numDistConstraints++;
            constraintIndices.push(cIdx);
            this.setDistConstraint(cIdx, indices[i]!, indices[i+1]!, initialSegLen, 0.000001);
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segments * 3), 3));
        const mesh = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x00ffff }));
        this.scene.add(mesh);

        const rope = { indices, constraintIndices, mesh, segments, segmentLength: initialSegLen };
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
        this.particles[off + 7] = 0.1; // radius
    }

    setDistConstraint(i: number, a: number, b: number, len: number, compliance: number): void {
        const off = i * 4;
        this.distConstraints[off] = a;
        this.distConstraints[off + 1] = b;
        // Create a temporary view to write floats into the Uint32 buffer
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

        const substeps = 12;
        const dt = 1.0 / 60.0;

        // CORRECT UNIFORM BUFFER LAYOUT (Mixed Types)
        const paramsBuffer = new ArrayBuffer(64);
        const paramsF32 = new Float32Array(paramsBuffer);
        const paramsU32 = new Uint32Array(paramsBuffer);
        const paramsI32 = new Int32Array(paramsBuffer);

        // Layout must match WGSL struct Params alignment
        paramsF32[0] = dt; 
        paramsF32[1] = -15.0; // gravity
        paramsU32[2] = this.numParticles;
        paramsU32[3] = this.numDistConstraints;
        paramsU32[4] = substeps;
        paramsU32[5] = 0; // padding
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
                    const px = this.particles[idx * 8];
                    const py = this.particles[idx * 8 + 1];
                    if (!isNaN(px!) && !isNaN(py!)) {
                        attr.setXYZ(i, px!, py!, 0);
                    }
                }
                attr.needsUpdate = true;
            }
        } catch (e) {
            console.error("Readback error", e);
        } finally {
            this.isReadingBack = false;
        }
    }

    pinActiveRope(rope: any, pos: THREE.Vector2) {
        const lastIdx = rope.indices[rope.segments - 1];
        // When pinning, we just set the particle mass to infinite (invMass = 0)
        // but keep the current position
        this.setParticle(lastIdx, pos, 0.0);
        this.activeRope = null;
        this.syncGPU();
    }

    adjustRopeLength(rope: any, delta: number) {
        const minLen = 0.05;
        const maxLen = 1.0;
        rope.segmentLength = Math.max(minLen, Math.min(maxLen, rope.segmentLength + delta * 0.02));
        
        for (let i = 0; i < rope.constraintIndices.length; i++) {
            const cIdx = rope.constraintIndices[i];
            const idxA = rope.indices[i];
            const idxB = rope.indices[i+1];
            this.setDistConstraint(cIdx, idxA, idxB, rope.segmentLength, 0.000001);
        }
        
        if (this.device && this.distConstraintBuffer) {
            this.device.queue.writeBuffer(this.distConstraintBuffer, 0, this.distConstraints);
        }
    }
}
