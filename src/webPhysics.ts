import * as THREE from 'three';

export const MAX_PARTICLES = 8192;
export const MAX_CONSTRAINTS = 16384;
export const MAX_OBSTACLES = 1024;
export const MAX_EVENTS = 4096;

export interface SimulationParams {
    dt: number;
    substeps: number;
    gravity: THREE.Vector2;
    worldBounds: THREE.Vector4;
    collisionIterations: number;
}

export class WebPhysics {
    renderer: any;
    scene: THREE.Scene;
    device: GPUDevice | null = null;
    ready = false;

    particles = new Float32Array(MAX_PARTICLES * 8);
    constraints = new Float32Array(MAX_CONSTRAINTS * 8);
    obstacles = new Float32Array(MAX_OBSTACLES * 8);

    public particleAlloc = new Uint8Array(MAX_PARTICLES);
    public constraintAlloc = new Uint8Array(MAX_CONSTRAINTS);
    private activeParticleIndices: number[] = [];

    private particleBuffer!: GPUBuffer;
    private constraintBuffer!: GPUBuffer;
    private obstacleBuffer!: GPUBuffer;
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

    constructor(renderer: any, scene: THREE.Scene) {
        this.renderer = renderer;
        this.scene = scene;
    }

    async init() {
        const device = this.renderer.device || this.renderer.backend?.device;
        if (!device) throw new Error('WebGPU device not found');
        this.device = device;

        const shaderCode = await (await fetch(new URL('./physics.wgsl', import.meta.url))).text();
        const shaderModule = device.createShaderModule({ code: shaderCode });

        this.particleBuffer = device.createBuffer({ size: this.particles.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
        this.constraintBuffer = device.createBuffer({ size: this.constraints.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.obstacleBuffer = device.createBuffer({ size: this.obstacles.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.paramsBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.eventBuffer = device.createBuffer({ size: MAX_EVENTS * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
        this.eventCountBuffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
        this.stagingBuffer = device.createBuffer({ size: this.particles.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

        const bgl = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }
            ]
        });

        this.bindGroup = device.createBindGroup({
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

        const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
        const createPipe = (entry: string) => device.createComputePipeline({ layout, compute: { module: shaderModule, entryPoint: entry } });

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
        for (const idx of indices) { this.constraintAlloc[idx] = 0; this.constraints.fill(0, idx * 8, idx * 8 + 8); }
        this.queuedSync = true;
    }

    setConstraint(idx: number, a: number, b: number, cIdx: number, cType: number, restValue: number, comp: number, anchor: THREE.Vector2) {
        const off = idx * 8;
        const u32 = new Uint32Array(this.constraints.buffer);
        const i32 = new Int32Array(this.constraints.buffer);
        u32[off] = a;
        i32[off+1] = b;
        i32[off+2] = cIdx;
        u32[off+3] = cType;
        this.constraints[off+4] = restValue;
        this.constraints[off+5] = comp;
        this.constraints[off+6] = anchor.x;
        this.constraints[off+7] = anchor.y;
        this.queuedSync = true;
    }

    setParticle(idx: number, pos: THREE.Vector2, prevPos: THREE.Vector2, mass: number, friction: number, radius: number, mask: number, appearance: number = 0, flags: number = 0) {
        const off = idx * 8;
        this.particles[off] = pos.x; this.particles[off+1] = pos.y;
        this.particles[off+2] = prevPos.x; this.particles[off+3] = prevPos.y;
        this.particles[off+4] = mass; this.particles[off+5] = friction; this.particles[off+6] = radius;
        
        // Pack: mask (8bit), appearance (8bit), flags (8bit), reserved (8bit)
        const meta = (mask & 0xFF) | ((appearance & 0xFF) << 8) | ((flags & 0xFF) << 16);
        new Uint32Array(this.particles.buffer)[off+7] = meta;
        
        this.dirtyParticles.add(idx);
        this.queuedSync = true;
    }

    addForce(idx: number, fx: number, fy: number) {
        const off = idx * 8;
        this.particles[off + 2] -= fx;
        this.particles[off + 3] -= fy;
        this.dirtyParticles.add(idx);
        this.queuedSync = true;
    }

    findNearest(pos: THREE.Vector2, radius: number, mask: number = 0xFF): number {
        let nearest = -1;
        let minDistSq = radius * radius;
        for (const i of this.activeParticleIndices) {
            const off = i * 8;
            const m = new Uint32Array(this.particles.buffer)[off + 7] & 0xFF;
            if ((m & mask) === 0) continue;
            const dx = this.particles[off] - pos.x;
            const dy = this.particles[off+1] - pos.y;
            const d2 = dx*dx + dy*dy;
            if (d2 < minDistSq) { minDistSq = d2; nearest = i; }
        }
        return nearest;
    }

    findAnchor(pos: THREE.Vector2, ignoreIndices: number[] = []): { pos: THREE.Vector2; type: 'static' | 'particle'; targetIdx?: number } | null {
        const bx = 11.8, by = 6.8;
        if (Math.abs(pos.x) > bx || Math.abs(pos.y) > by) {
            return { pos: pos.clone().clamp(new THREE.Vector2(-bx, -by), new THREE.Vector2(bx, by)), type: 'static' };
        }

        const pIdx = this.findNearest(pos, 0.5);
        if (pIdx !== -1 && !ignoreIndices.includes(pIdx)) {
            return { pos: new THREE.Vector2(this.particles[pIdx * 8], this.particles[pIdx * 8 + 1]), type: 'particle', targetIdx: pIdx };
        }

        for (let i = 0; i < this.numObstacles; i++) {
            const off = i * 8;
            const obsPos = new THREE.Vector2(this.obstacles[off], this.obstacles[off + 1]);
            const rot = this.obstacles[off + 2];
            const meta = new Uint32Array(this.obstacles.buffer)[off + 3];
            const shapeType = meta & 0xFF;
            const p = [this.obstacles[off + 4], this.obstacles[off + 5], this.obstacles[off + 6], this.obstacles[off + 7]];

            const s = Math.sin(-rot), c = Math.cos(-rot);
            const lp = new THREE.Vector2((pos.x - obsPos.x) * c - (pos.y - obsPos.y) * s, (pos.x - obsPos.x) * s + (pos.y - obsPos.y) * c);

            let d = 1000.0;
            if (shapeType === 0) d = lp.length() - p[0];
            else if (shapeType === 1) {
                const q = new THREE.Vector2(Math.abs(lp.x) - p[0], Math.abs(lp.y) - p[1]);
                d = Math.max(q.x, 0) + Math.max(q.y, 0) + Math.min(Math.max(q.x, q.y), 0);
            }

            if (d < 0.5) {
                return { pos: pos.clone(), type: 'static' };
            }
        }
        return null;
    }

    setObstacle(idx: number, pos: THREE.Vector2, rotation: number, shapeType: number, params: number[], friction: number, appearance: number = 0, flags: number = 0) {
        const off = idx * 8;
        const u32 = new Uint32Array(this.obstacles.buffer);
        this.obstacles[off] = pos.x; 
        this.obstacles[off+1] = pos.y;
        this.obstacles[off+2] = rotation; 
        
        const f8 = Math.max(0, Math.min(255, Math.floor(friction * 255)));
        // Pack meta: shape (8bit), appearance (8bit), flags (8bit), friction (8bit)
        u32[off+3] = (shapeType & 0xFF) | ((appearance & 0xFF) << 8) | ((flags & 0xFF) << 16) | (f8 << 24);
        
        this.obstacles[off+4] = params[0]; 
        this.obstacles[off+5] = params[1]; 
        this.obstacles[off+6] = params[2];
        this.obstacles[off+7] = params[3];
        this.queuedSync = true;
    }

    step(params: SimulationParams) {
        if (!this.ready || this.isReadingBack) return;

        if (this.queuedSync) {
            this.maxParticleIndex = this.activeParticleIndices.length > 0 ? Math.max(...this.activeParticleIndices) : 0;
            this.device!.queue.writeBuffer(this.particleBuffer, 0, this.particles);
            this.device!.queue.writeBuffer(this.constraintBuffer, 0, this.constraints);
            this.device!.queue.writeBuffer(this.obstacleBuffer, 0, this.obstacles);
            this.queuedSync = false;
            this.dirtyParticles.clear();
        }

        const paramData = new Float32Array(16);
        const u32 = new Uint32Array(paramData.buffer);
        paramData[0] = params.dt; u32[1] = params.substeps;
        paramData[2] = params.gravity.x; paramData[3] = params.gravity.y;
        paramData[4] = params.worldBounds.x; paramData[5] = params.worldBounds.y;
        paramData[6] = params.worldBounds.z; paramData[7] = params.worldBounds.w;
        u32[8] = params.collisionIterations;
        u32[9] = this.numObstacles;
        this.device!.queue.writeBuffer(this.paramsBuffer, 0, paramData);

        const enc = this.device!.createCommandEncoder();

        // 1. Integrate once per frame
        const pInt = enc.beginComputePass(); pInt.setBindGroup(0, this.bindGroup); pInt.setPipeline(this.pipelines['integrate']); pInt.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / 64)); pInt.end();

        // 2. XPBD Substeps for constraints and collisions
        for (let i = 0; i < params.substeps; i++) {
            const pConstr = enc.beginComputePass(); pConstr.setBindGroup(0, this.bindGroup); pConstr.setPipeline(this.pipelines['solveConstraints']); pConstr.dispatchWorkgroups(Math.ceil(MAX_CONSTRAINTS / 64)); pConstr.end();
            
            for (let c = 0; c < params.collisionIterations; c++) {
                const pColl = enc.beginComputePass(); pColl.setBindGroup(0, this.bindGroup); pColl.setPipeline(this.pipelines['solveCollisions']); pColl.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / 64)); pColl.end();
                const pPColl = enc.beginComputePass(); pPColl.setBindGroup(0, this.bindGroup); pPColl.setPipeline(this.pipelines['solveParticleCollisions']); pPColl.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / 64)); pPColl.end();
            }
        }

        enc.copyBufferToBuffer(this.particleBuffer, 0, this.stagingBuffer, 0, this.particles.byteLength);
        this.device!.queue.submit([enc.finish()]);

        this.isReadingBack = true;
        this.stagingBuffer.mapAsync(GPUMapMode.READ).then(() => {
            const data = new Float32Array(this.stagingBuffer.getMappedRange());
            for (const i of this.activeParticleIndices) {
                if (!this.dirtyParticles.has(i)) {
                    const off = i * 8;
                    this.particles[off] = data[off];
                    this.particles[off + 1] = data[off + 1];
                    this.particles[off + 2] = data[off + 2];
                    this.particles[off + 3] = data[off + 3];
                    // Keep meta from GPU as well (might be updated by flags)
                    new Uint32Array(this.particles.buffer)[off+7] = new Uint32Array(data.buffer)[off+7];
                }
            }
            this.stagingBuffer.unmap();
            this.isReadingBack = false;
        }).catch(() => { this.isReadingBack = false; });
    }
}
