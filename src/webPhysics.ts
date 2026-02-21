export const MAX_PARTICLES = 8192;
export const MAX_CONSTRAINTS = 16384;
export const MAX_OBSTACLES = 1024;
export const MAX_EVENTS = 4096;

export interface SimulationParams {
    dt: number;
    substeps: number;
    gravity: Float32Array;
    worldBounds: Float32Array;
    collisionIterations: number;
    isPaused: boolean;
}

export class WebPhysics {
    device: GPUDevice;
    ready = false;

    particles = new Float32Array(MAX_PARTICLES * 8);
    constraints = new Int32Array(MAX_CONSTRAINTS * 8).fill(-1);
    obstacles = new Float32Array(MAX_OBSTACLES * 8);

    public particleAlloc = new Uint8Array(MAX_PARTICLES);
    public constraintAlloc = new Uint8Array(MAX_CONSTRAINTS);
    private activeParticleIndices: number[] = [];

    public particleBuffer!: GPUBuffer;
    public constraintBuffer!: GPUBuffer;
    public obstacleBuffer!: GPUBuffer;
    private paramsBuffer!: GPUBuffer;
    private eventBuffer!: GPUBuffer;
    private eventCountBuffer!: GPUBuffer;
    private stagingBuffer!: GPUBuffer;
    private bindGroup!: GPUBindGroup;
    private pipelines: Record<string, GPUComputePipeline> = {};
    private isReadingBack = false;
    public queuedSync = false;
    public numObstacles = 0;
    public maxParticleIndex = 0;
    private dirtyParticles = new Set<number>();

    constructor(device: GPUDevice) {
        this.device = device;
    }

    async init() {
        const shaderCode = await (await fetch(new URL('./physics.wgsl', import.meta.url))).text();
        const shaderModule = this.device.createShaderModule({ code: shaderCode });

        this.particleBuffer = this.device.createBuffer({ size: this.particles.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
        this.constraintBuffer = this.device.createBuffer({ size: this.constraints.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.obstacleBuffer = this.device.createBuffer({ size: this.obstacles.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.paramsBuffer = this.device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.eventBuffer = this.device.createBuffer({ size: MAX_EVENTS * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
        this.eventCountBuffer = this.device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
        this.stagingBuffer = this.device.createBuffer({ size: this.particles.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

        const bgl = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }
            ]
        });

        this.bindGroup = this.device.createBindGroup({
            layout: bgl,
            entries: [
                { binding: 0, resource: { buffer: this.particleBuffer } },
                { binding: 1, resource: { buffer: this.constraintBuffer } },
                { binding: 2, resource: { buffer: this.obstacleBuffer } },
                { binding: 3, resource: { buffer: this.paramsBuffer } },
                { binding: 4, resource: { buffer: this.eventBuffer } },
                { binding: 5, resource: { buffer: this.eventCountBuffer } }
            ]
        });

        const layout = this.device.createPipelineLayout({ bindGroupLayouts: [bgl] });
        const createPipe = (entry: string) => this.device.createComputePipeline({ layout, compute: { module: shaderModule, entryPoint: entry } });

        this.pipelines['integrate'] = createPipe('integrate');
        this.pipelines['solveConstraints'] = createPipe('solveConstraints');
        this.pipelines['solveCollisions'] = createPipe('solveCollisions');
        this.pipelines['solveParticleCollisions'] = createPipe('solveParticleCollisions');

        this.ready = true;
    }

    allocateParticles(count: number): number[] {
        const indices: number[] = [];
        for (let i = 0; i < MAX_PARTICLES && indices.length < count; i++) {
            if (!this.particleAlloc[i]) {
                this.particleAlloc[i] = 1;
                indices.push(i);
                this.activeParticleIndices.push(i);
                this.maxParticleIndex = Math.max(this.maxParticleIndex, i);
            }
        }
        return indices;
    }

    releaseParticles(indices: number[]) {
        const set = new Set(indices);
        this.activeParticleIndices = this.activeParticleIndices.filter(i => !set.has(i));
        for (const idx of indices) {
            this.particleAlloc[idx] = 0;
            this.particles.fill(0, idx * 8, idx * 8 + 8);
            this.dirtyParticles.add(idx);
        }
        this.queuedSync = true;
    }

    allocateConstraints(count: number): number[] {
        const indices: number[] = [];
        for (let i = 0; i < MAX_CONSTRAINTS && indices.length < count; i++) {
            if (!this.constraintAlloc[i]) { this.constraintAlloc[i] = 1; indices.push(i); }
        }
        return indices;
    }

    releaseConstraints(indices: number[]) {
        for (const idx of indices) {
            this.constraintAlloc[idx] = 0;
            this.constraints.fill(-1, idx * 8, idx * 8 + 8);
        }
        this.queuedSync = true;
    }

    setConstraint(idx: number, a: number, b: number, cIdx: number, cType: number, restValue: number, comp: number, anchor: Float32Array) {
        const off = idx * 8;
        const f32 = new Float32Array(this.constraints.buffer);
        this.constraints[off] = a;
        this.constraints[off+1] = b;
        this.constraints[off+2] = cIdx;
        this.constraints[off+3] = cType;
        f32[off+4] = restValue;
        f32[off+5] = comp;
        f32[off+6] = anchor[0]!;
        f32[off+7] = anchor[1]!;
        this.queuedSync = true;
    }

    setParticle(idx: number, pos: Float32Array, prevPos: Float32Array, mass: number, friction: number, radius: number, mask: number, appearance: number = 0, flags: number = 0) {
        const off = idx * 8;
        this.particles[off] = pos[0]!; this.particles[off+1] = pos[1]!;
        this.particles[off+2] = prevPos[0]!; this.particles[off+3] = prevPos[1]!;
        this.particles[off+4] = mass; this.particles[off+5] = friction; this.particles[off+6] = radius;
        const meta = (mask & 0xFF) | ((appearance & 0xFF) << 8) | ((flags & 0xFF) << 16);
        new Uint32Array(this.particles.buffer)[off+7] = meta;
        this.dirtyParticles.add(idx);
        this.queuedSync = true;
    }

    findNearest(pos: Float32Array, radius: number, mask: number = 0xFF): number {
        let nearest = -1;
        let minDistSq = radius * radius;
        for (const i of this.activeParticleIndices) {
            const off = i * 8;
            const m = new Uint32Array(this.particles.buffer)[off + 7]! & 0xFF;
            if ((m & mask) === 0) continue;
            const px = this.particles[off];
            const py = this.particles[off+1];
            if (px === undefined || py === undefined) continue;
            const dx = px - pos[0]!;
            const dy = py - pos[1]!;
            const d2 = dx*dx + dy*dy;
            if (d2 < minDistSq) { minDistSq = d2; nearest = i; }
        }
        return nearest;
    }

    findAnchor(pos: Float32Array, ignoreIndices: number[] = []): { pos: Float32Array; type: 'static' | 'particle'; targetIdx?: number } | null {
        const bx = 11.8, by = 6.8;
        if (Math.abs(pos[0]!) > bx || Math.abs(pos[1]!) > by) {
            const clamped = new Float32Array([
                Math.max(-bx, Math.min(bx, pos[0]!)),
                Math.max(-by, Math.min(by, pos[1]!))
            ]);
            return { pos: clamped, type: 'static' };
        }

        const pIdx = this.findNearest(pos, 0.5);
        if (pIdx !== -1 && !ignoreIndices.includes(pIdx)) {
            const off = pIdx * 8;
            return { pos: new Float32Array([this.particles[off]!, this.particles[off + 1]!]), type: 'particle', targetIdx: pIdx };
        }

        for (let i = 0; i < this.numObstacles; i++) {
            const off = i * 8;
            const obsPos = new Float32Array([this.obstacles[off]!, this.obstacles[off + 1]!]);
            const rot = this.obstacles[off + 2]!;
            const meta = new Uint32Array(this.obstacles.buffer)[off + 3]!;
            const shapeType = meta & 0xFF;
            const p = [this.obstacles[off + 4]!, this.obstacles[off + 5]!, this.obstacles[off + 6]!, this.obstacles[off + 7]!];

            const s = Math.sin(-rot), c = Math.cos(-rot);
            const dx = pos[0]! - obsPos[0]!;
            const dy = pos[1]! - obsPos[1]!;
            const lpx = dx * c - dy * s;
            const lpy = dx * s + dy * c;

            let d = 1000.0;
            if (shapeType === 0) {
                d = Math.sqrt(lpx*lpx + lpy*lpy) - p[0]!;
            } else if (shapeType === 1) {
                const qx = Math.abs(lpx) - p[0]!;
                const qy = Math.abs(lpy) - p[1]!;
                d = Math.max(qx, 0) + Math.max(qy, 0) + Math.min(Math.max(qx, qy), 0);
            }

            if (d < 0.5) {
                return { pos: new Float32Array([pos[0]!, pos[1]!]), type: 'static' };
            }
        }
        return null;
    }

    setObstacle(idx: number, pos: Float32Array, rotation: number, shapeType: number, params: Float32Array, friction: number, appearance: number = 0, flags: number = 0) {
        const off = idx * 8;
        const u32 = new Uint32Array(this.obstacles.buffer);
        this.obstacles[off] = pos[0]!; 
        this.obstacles[off+1] = pos[1]!;
        this.obstacles[off+2] = rotation; 
        const f8 = Math.max(0, Math.min(255, Math.floor(friction * 255)));
        u32[off+3] = (shapeType & 0xFF) | ((appearance & 0xFF) << 8) | ((flags & 0xFF) << 16) | (f8 << 24);
        this.obstacles[off+4] = params[0]!; 
        this.obstacles[off+5] = params[1]!; 
        this.obstacles[off+6] = params[2]!;
        this.obstacles[off+7] = params[3]!;
        this.queuedSync = true;
    }

    step(params: SimulationParams) {
        if (!this.ready || this.isReadingBack) return;

        if (this.queuedSync) {
            this.device.queue.writeBuffer(this.particleBuffer, 0, this.particles);
            this.device.queue.writeBuffer(this.constraintBuffer, 0, this.constraints);
            this.device.queue.writeBuffer(this.obstacleBuffer, 0, this.obstacles);
            this.queuedSync = false;
            this.dirtyParticles.clear();
        }

        const paramData = new Float32Array(16);
        const u32 = new Uint32Array(paramData.buffer);
        paramData[0] = params.dt; u32[1] = params.substeps;
        paramData[2] = params.gravity[0]!; paramData[3] = params.gravity[1]!;
        paramData[4] = params.worldBounds[0]!; paramData[5] = params.worldBounds[1]!;
        paramData[6] = params.worldBounds[2]!; paramData[7] = params.worldBounds[3]!;
        u32[8] = params.collisionIterations;
        u32[9] = this.numObstacles;
        u32[10] = params.isPaused ? 1 : 0;
        this.device.queue.writeBuffer(this.paramsBuffer, 0, paramData);

        const enc = this.device.createCommandEncoder();
        const pInt = enc.beginComputePass(); 
        pInt.setBindGroup(0, this.bindGroup); 
        const p1 = this.pipelines['integrate'];
        if (p1) pInt.setPipeline(p1); 
        pInt.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / 64)); 
        pInt.end();

        for (let i = 0; i < params.substeps; i++) {
            const pConstr = enc.beginComputePass(); 
            pConstr.setBindGroup(0, this.bindGroup); 
            const p2 = this.pipelines['solveConstraints'];
            if (p2) pConstr.setPipeline(p2); 
            pConstr.dispatchWorkgroups(Math.ceil(MAX_CONSTRAINTS / 64)); 
            pConstr.end();
            
            for (let c = 0; c < params.collisionIterations; c++) {
                const pColl = enc.beginComputePass(); 
                pColl.setBindGroup(0, this.bindGroup); 
                const p3 = this.pipelines['solveCollisions'];
                if (p3) pColl.setPipeline(p3); 
                pColl.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / 64)); 
                pColl.end();

                const pPColl = enc.beginComputePass(); 
                pPColl.setBindGroup(0, this.bindGroup); 
                const p4 = this.pipelines['solveParticleCollisions'];
                if (p4) pPColl.setPipeline(p4); 
                pPColl.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / 64)); 
                pPColl.end();
            }
        }

        enc.copyBufferToBuffer(this.particleBuffer, 0, this.stagingBuffer, 0, this.particles.byteLength);
        this.device.queue.submit([enc.finish()]);

        this.isReadingBack = true;
        this.stagingBuffer.mapAsync(GPUMapMode.READ).then(() => {
            const mapped = this.stagingBuffer.getMappedRange();
            const data = new Float32Array(mapped);
            for (const i of this.activeParticleIndices) {
                if (!this.dirtyParticles.has(i)) {
                    const off = i * 8;
                    this.particles[off] = data[off]!;
                    this.particles[off + 1] = data[off + 1]!;
                    this.particles[off + 2] = data[off + 2]!;
                    this.particles[off + 3] = data[off + 3]!;
                    new Uint32Array(this.particles.buffer)[off+7] = new Uint32Array(data.buffer)[off+7]!;
                }
            }
            this.stagingBuffer.unmap();
            this.isReadingBack = false;
        }).catch(() => { this.isReadingBack = false; });
    }
}