import * as THREE from 'three';

export const MAX_PARTICLES = 16384;
export const MAX_CONSTRAINTS = 16384;
export const MAX_OBSTACLES = 1024;

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
    obstacles = new Float32Array(MAX_OBSTACLES * 16);

    private particleAlloc = new Uint8Array(MAX_PARTICLES);
    private constraintAlloc = new Uint8Array(MAX_CONSTRAINTS);

    private particleBuffer!: GPUBuffer;
    private constraintBuffer!: GPUBuffer;
    private obstacleBuffer!: GPUBuffer;
    private paramsBuffer!: GPUBuffer;
    private stagingBuffer!: GPUBuffer;

    private bindGroup!: GPUBindGroup;
    private pipelines: Record<string, GPUComputePipeline> = {};
    private isReadingBack = false;
    public queuedSync = false;
    public numObstacles = 0;
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
        this.stagingBuffer = device.createBuffer({ size: this.particles.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

        const bgl = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }
            ]
        });

        this.bindGroup = device.createBindGroup({
            layout: bgl,
            entries: [
                { binding: 0, resource: { buffer: this.particleBuffer } },
                { binding: 1, resource: { buffer: this.constraintBuffer } },
                { binding: 2, resource: { buffer: this.obstacleBuffer } },
                { binding: 3, resource: { buffer: this.paramsBuffer } }
            ]
        });

        const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
        const createPipe = (entry: string) => device.createComputePipeline({ layout, compute: { module: shaderModule, entryPoint: entry } });

        this.pipelines['integrate'] = createPipe('integrate');
        this.pipelines['solveConstraints'] = createPipe('solveConstraints');
        this.pipelines['solveCollisions'] = createPipe('solveCollisions');

        this.ready = true;
    }

    allocateParticles(count: number): number[] {
        const indices: number[] = [];
        for (let i = 0; i < MAX_PARTICLES && indices.length < count; i++) {
            if (!this.particleAlloc[i]) { this.particleAlloc[i] = 1; indices.push(i); }
        }
        return indices;
    }

    releaseParticles(indices: number[]) {
        for (const idx of indices) { 
            this.particleAlloc[idx] = 0; 
            this.particles.fill(0, idx * 8, idx * 8 + 8); 
            this.dirtyParticles.add(idx);
        }
        this.queuedSync = true;
    }

    setParticle(idx: number, pos: THREE.Vector2, prevPos: THREE.Vector2, mass: number, friction: number, radius: number, mask: number) {
        const off = idx * 8;
        this.particles[off] = pos.x; this.particles[off+1] = pos.y;
        this.particles[off+2] = prevPos.x; this.particles[off+3] = prevPos.y;
        this.particles[off+4] = mass; this.particles[off+5] = friction; this.particles[off+6] = radius;
        new Uint32Array(this.particles.buffer)[off+7] = mask;
        this.dirtyParticles.add(idx);
        this.queuedSync = true;
    }

    setObstacle(idx: number, pos: THREE.Vector2, rotation: number, shapeType: number, params: number[], friction: number) {
        const off = idx * 16;
        const u32 = new Uint32Array(this.obstacles.buffer);
        this.obstacles[off] = pos.x; this.obstacles[off+1] = pos.y;
        this.obstacles[off+2] = rotation; u32[off+3] = shapeType;
        this.obstacles[off+4] = params[0]; this.obstacles[off+5] = params[1]; this.obstacles[off+6] = params[2];
        this.obstacles[off+7] = params[3]; this.obstacles[off+8] = params[4];
        this.obstacles[off+9] = friction;
        this.queuedSync = true;
    }

    step(params: SimulationParams) {
        if (!this.ready || this.isReadingBack) return;

        if (this.queuedSync) {
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
        
        const pInt = enc.beginComputePass(); pInt.setBindGroup(0, this.bindGroup); pInt.setPipeline(this.pipelines['integrate']); pInt.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / 64)); pInt.end();

        for (let i = 0; i < params.substeps; i++) {
            const pConstr = enc.beginComputePass(); pConstr.setBindGroup(0, this.bindGroup); pConstr.setPipeline(this.pipelines['solveConstraints']); pConstr.dispatchWorkgroups(Math.ceil(MAX_CONSTRAINTS / 64)); pConstr.end();
            for (let c = 0; c < params.collisionIterations; c++) {
                const pColl = enc.beginComputePass(); pColl.setBindGroup(0, this.bindGroup); pColl.setPipeline(this.pipelines['solveCollisions']); pColl.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / 64)); pColl.end();
            }
        }

        enc.copyBufferToBuffer(this.particleBuffer, 0, this.stagingBuffer, 0, this.particles.byteLength);
        this.device!.queue.submit([enc.finish()]);

        this.isReadingBack = true;
        this.stagingBuffer.mapAsync(GPUMapMode.READ).then(() => {
            const data = new Float32Array(this.stagingBuffer.getMappedRange());
            for (let i = 0; i < MAX_PARTICLES; i++) {
                if (this.particleAlloc[i] && !this.dirtyParticles.has(i)) {
                    const off = i * 8;
                    this.particles[off] = data[off];
                    this.particles[off + 1] = data[off + 1];
                    this.particles[off + 2] = data[off + 2];
                    this.particles[off + 3] = data[off + 3];
                }
            }
            this.stagingBuffer.unmap();
            this.isReadingBack = false;
        }).catch(() => { this.isReadingBack = false; });
    }
}
