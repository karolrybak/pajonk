export const MAX_PARTICLES = 8192;
export const MAX_CONSTRAINTS = 8192;
export const MAX_OBSTACLES = 1024;
export const MAX_QUERIES = 128;

// Command types for the GPU Command Queue
const CMD = {
    ADD_PARTICLE: 1,
    MOVE_PARTICLE: 2,
    SET_CONSTRAINT: 3,
    REM_PARTICLE: 4,
    REM_CONSTRAINT: 5,
    SET_OBSTACLE: 6
};

export interface SimulationParams {
    dt: number;
    substeps: number;
    gravity: Float32Array;
    worldBounds: Float32Array;
    collisionIterations: number;
    isPaused: boolean;
    phase?: number;
}

export interface QueryResult {
    count: number;
    hitType: number;
    hitIdx: number;
    distance: number;
    hitPos: Float32Array;
    hitNormal: Float32Array;
    hits: number[];
}

export class WebPhysics {
    device: GPUDevice;
    ready = false;

    // Main CPU-side buffer mirrors (used for local searches and initialization)
    particles = new Float32Array(MAX_PARTICLES * 8);
    constraints = new Int32Array(MAX_CONSTRAINTS * 8).fill(-1);
    obstacles = new Float32Array(MAX_OBSTACLES * 8);

    public particleAlloc = new Uint8Array(MAX_PARTICLES);
    public constraintAlloc = new Uint8Array(MAX_CONSTRAINTS);
    private activeParticleIndices: number[] = [];

    public particleBuffer!: GPUBuffer;
    public constraintBuffer!: GPUBuffer;
    public obstacleBuffer!: GPUBuffer;
    public commandBuffer!: GPUBuffer;
    public gridBuffer!: GPUBuffer;
    public nextNodeBuffer!: GPUBuffer;
    private stagingBuffer!: GPUBuffer;

    public queryBuffer!: GPUBuffer;
    public queryResultBuffer!: GPUBuffer;
    public queryStagingBuffer!: GPUBuffer;

    private paramsBuffers: GPUBuffer[] = [];
    private bindGroups: GPUBindGroup[] = [];
    private pipelines: Record<string, GPUComputePipeline> = {};
    private isReadingBack = false;
    private isQueryReadingBack = false;
    public numObstacles = 0;
    public maxColor = 0;

    // Command Queue structure: 48 bytes per command (12 floats/u32s)
    private commandQueue = new ArrayBuffer(4096 * 48);
    private commandU32 = new Uint32Array(this.commandQueue);
    private commandF32 = new Float32Array(this.commandQueue);
    private numCommands = 0;

    private pendingQueries: { type: number, origin: Float32Array, dirOrRadius: Float32Array, maxDist: number, mask: number, resolve: Function }[] = [];
    private readingQueries: Function[] = [];

    // Graph coloring state for constraints
    private particleColors = Array.from({ length: MAX_PARTICLES }, () => new Set<number>());
    private colorCounts = new Int32Array(16);

    constructor(device: GPUDevice) {
        this.device = device;
    }

    async init() {
        const shaderCode = await (await fetch(new URL('./physics.wgsl', import.meta.url))).text();
        const shaderModule = this.device.createShaderModule({ code: shaderCode });

        this.particleBuffer = this.device.createBuffer({ size: this.particles.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
        this.constraintBuffer = this.device.createBuffer({ size: this.constraints.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.obstacleBuffer = this.device.createBuffer({ size: this.obstacles.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.commandBuffer = this.device.createBuffer({ size: this.commandQueue.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.gridBuffer = this.device.createBuffer({ size: 4096 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.nextNodeBuffer = this.device.createBuffer({ size: MAX_PARTICLES * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.stagingBuffer = this.device.createBuffer({ size: this.particles.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

        this.queryBuffer = this.device.createBuffer({ size: MAX_QUERIES * 48, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.queryResultBuffer = this.device.createBuffer({ size: MAX_QUERIES * 96, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        this.queryStagingBuffer = this.device.createBuffer({ size: MAX_QUERIES * 96, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

        const bgl = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }
            ]
        });

        // Create multiple uniform buffers for different coloring phases
        for (let i = 0; i < 16; i++) {
            const pBuf = this.device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            this.paramsBuffers.push(pBuf);
            this.bindGroups.push(this.device.createBindGroup({
                layout: bgl,
                entries: [
                    { binding: 0, resource: { buffer: this.particleBuffer } },
                    { binding: 1, resource: { buffer: this.constraintBuffer } },
                    { binding: 2, resource: { buffer: this.obstacleBuffer } },
                    { binding: 3, resource: { buffer: pBuf } },
                    { binding: 4, resource: { buffer: this.commandBuffer } },
                    { binding: 5, resource: { buffer: this.gridBuffer } },
                    { binding: 6, resource: { buffer: this.nextNodeBuffer } },
                    { binding: 7, resource: { buffer: this.queryBuffer } },
                    { binding: 8, resource: { buffer: this.queryResultBuffer } }
                ]
            }));
        }

        const layout = this.device.createPipelineLayout({ bindGroupLayouts: [bgl] });
        const createPipe = (entry: string) => this.device.createComputePipeline({ layout, compute: { module: shaderModule, entryPoint: entry } });

        ['processCommands', 'clearGrid', 'buildGrid', 'integrate', 'solveConstraints', 'solveCollisions', 'solveParticleCollisions', 'applyFriction', 'applyParticleFriction', 'processQueries'].forEach(e => {
            this.pipelines[e] = createPipe(e);
        });

        this.ready = true;
    }

    private pushCommand(cmdType: number, index: number, d0: number[], d1: number[], d0w_is_u32 = false, d1w_is_u32 = false) {
        if (this.numCommands >= 4096) return;
        const off = this.numCommands * 12; // 12 elements * 4 bytes = 48 byte struct
        this.commandU32[off] = cmdType;
        this.commandU32[off + 1] = index;
        this.commandU32[off + 2] = 0; // Pad
        this.commandU32[off + 3] = 0; // Pad
        
        this.commandF32[off + 4] = d0[0] ?? 0;
        this.commandF32[off + 5] = d0[1] ?? 0;
        this.commandF32[off + 6] = d0[2] ?? 0;
        if (d0w_is_u32) this.commandU32[off + 7] = d0[3] ?? 0;
        else this.commandF32[off + 7] = d0[3] ?? 0;

        this.commandF32[off + 8] = d1[0] ?? 0;
        this.commandF32[off + 9] = d1[1] ?? 0;
        this.commandF32[off + 10] = d1[2] ?? 0;
        if (d1w_is_u32) this.commandU32[off + 11] = d1[3] ?? 0;
        else this.commandF32[off + 11] = d1[3] ?? 0;

        this.numCommands++;
    }

    assignColor(a: number, b: number): number {
        if (b < 0) return 0;
        let color = 0;
        const setA = this.particleColors[a];
        const setB = this.particleColors[b];
        while ((setA && setA.has(color)) || (setB && setB.has(color))) color++;
        if (color >= 16) color = 15;
        setA?.add(color); setB?.add(color);
        this.colorCounts[color]++;
        while (this.maxColor < 15 && this.colorCounts[this.maxColor + 1] > 0) this.maxColor++;
        return color;
    }

    removeConstraintColor(idx: number) {
        const off = idx * 8;
        const a = this.constraints[off]!;
        const b = this.constraints[off + 1]!;
        const color = this.constraints[off + 2]!;
        if (a < 0) return;
        this.particleColors[a]?.delete(color);
        if (b >= 0) this.particleColors[b]?.delete(color);
        this.colorCounts[color]--;
        while (this.maxColor > 0 && this.colorCounts[this.maxColor] === 0) this.maxColor--;
    }

    allocateParticles(count: number): number[] {
        const indices: number[] = [];
        for (let i = 0; i < MAX_PARTICLES && indices.length < count; i++) {
            if (!this.particleAlloc[i]) {
                this.particleAlloc[i] = 1;
                indices.push(i);
                this.activeParticleIndices.push(i);
            }
        }
        return indices;
    }

    releaseParticles(indices: number[]) {
        const set = new Set(indices);
        this.activeParticleIndices = this.activeParticleIndices.filter(i => !set.has(i));
        for (const idx of indices) {
            this.particleAlloc[idx] = 0;
            if (this.particleColors[idx]) this.particleColors[idx].clear();
            this.particles.fill(0, idx * 8, idx * 8 + 8);
            this.pushCommand(CMD.REM_PARTICLE, idx, [0,0,0,0], [0,0,0,0]);
        }
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
            this.removeConstraintColor(idx);
            this.constraintAlloc[idx] = 0;
            this.constraints.fill(-1, idx * 8, idx * 8 + 8);
            this.pushCommand(CMD.REM_CONSTRAINT, idx, [0,0,0,0], [0,0,0,0]);
        }
    }

    setConstraint(idx: number, a: number, b: number, color: number, cType: number, restValue: number, comp: number, anchor: Float32Array) {
        const off = idx * 8;
        const f32 = new Float32Array(this.constraints.buffer);
        this.constraints[off] = a;
        this.constraints[off + 1] = b;
        this.constraints[off + 2] = color;
        this.constraints[off + 3] = cType;
        f32[off + 4] = restValue;
        f32[off + 5] = comp;
        f32[off + 6] = anchor[0]!;
        f32[off + 7] = anchor[1]!;
        this.pushCommand(CMD.SET_CONSTRAINT, idx, [a, b, color, cType], [restValue, comp, anchor[0]!, anchor[1]!], false, false);
    }

    setParticle(idx: number, pos: Float32Array, prevPos: Float32Array, mass: number, friction: number, radius: number, mask: number, appearance: number = 0, flags: number = 0) {
        const meta = (mask & 0xFF) | ((appearance & 0xFF) << 8) | ((flags & 0xFF) << 16);
        this.pushCommand(CMD.ADD_PARTICLE, idx, [pos[0]!, pos[1]!, prevPos[0]!, prevPos[1]!], [mass, friction, radius, meta], false, true);
        
        const off = idx * 8;
        this.particles[off] = pos[0]!; this.particles[off+1] = pos[1]!;
        this.particles[off+2] = prevPos[0]!; this.particles[off+3] = prevPos[1]!;
        this.particles[off+4] = mass; this.particles[off+5] = friction; this.particles[off+6] = radius;
        new Uint32Array(this.particles.buffer)[off+7] = meta;
    }

    updateParticlePos(idx: number, pos: Float32Array) {
        const off = idx * 8;
        this.particles[off] = pos[0]!; this.particles[off+1] = pos[1]!;
        this.particles[off+2] = pos[0]!; this.particles[off+3] = pos[1]!;
        this.pushCommand(CMD.MOVE_PARTICLE, idx, [pos[0]!, pos[1]!, pos[0]!, pos[1]!], [0,0,0,0]);
    }

    setObstacle(idx: number, pos: Float32Array, rotation: number, shapeType: number, params: Float32Array, friction: number, appearance: number = 0, flags: number = 0) {
        const off = idx * 8;
        const u32 = new Uint32Array(this.obstacles.buffer);
        const f8 = Math.max(0, Math.min(255, Math.floor(friction * 255)));
        const meta = (shapeType & 0xFF) | ((appearance & 0xFF) << 8) | ((flags & 0xFF) << 16) | (f8 << 24);
        this.obstacles[off] = pos[0]!; this.obstacles[off+1] = pos[1]!; this.obstacles[off+2] = rotation; u32[off+3] = meta;
        this.obstacles[off+4] = params[0]!; this.obstacles[off+5] = params[1]!; this.obstacles[off+6] = params[2]!; this.obstacles[off+7] = params[3]!;
        this.pushCommand(CMD.SET_OBSTACLE, idx, [pos[0]!, pos[1]!, rotation, meta], [params[0]!, params[1]!, params[2]!, params[3]!], true, false);
    }

    async queryRadius(pos: Float32Array, radius: number, mask: number = 0xFF): Promise<QueryResult> {
        return new Promise(resolve => {
            this.pendingQueries.push({ type: 2, origin: pos, dirOrRadius: new Float32Array([radius, 0]), maxDist: 0, mask, resolve });
        });
    }

    async raycast(origin: Float32Array, dir: Float32Array, maxDist: number, mask: number = 0xFF): Promise<QueryResult> {
        return new Promise(resolve => {
            this.pendingQueries.push({ type: 3, origin, dirOrRadius: dir, maxDist, mask, resolve });
        });
    }

    async ping(id: number): Promise<number> {
        return new Promise(resolve => {
            this.pendingQueries.push({
                type: 4, origin: new Float32Array([0, 0]), dirOrRadius: new Float32Array([0, 0]), maxDist: 0, mask: id, 
                resolve: (res: QueryResult) => resolve(res.hitIdx)
            });
        });
    }

    async findAnchor(pos: Float32Array, ignoreIndices: number[] = []): Promise<{ pos: Float32Array; type: 'static' | 'particle'; targetIdx?: number; radius?: number } | null> {
        const res = await this.queryRadius(pos, 0.6, 0xFF);
        let nearestP = -1;
        let minDistSq = 0.6 * 0.6;
        for (const idx of res.hits) {
            if (ignoreIndices.includes(idx)) continue;
            const px = this.particles[idx * 8]!;
            const py = this.particles[idx * 8 + 1]!;
            const d2 = (px - pos[0]!)**2 + (py - pos[1]!)**2;
            if (d2 < minDistSq) { minDistSq = d2; nearestP = idx; }
        }
        
        if (nearestP !== -1) {
            const pRadius = this.particles[nearestP * 8 + 6]!;
            const pPos = new Float32Array([this.particles[nearestP * 8]!, this.particles[nearestP * 8 + 1]!]);
            const delta = new Float32Array([pos[0]! - pPos[0]!, pos[1]! - pPos[1]!]);
            const dist = Math.sqrt(delta[0]*delta[0] + delta[1]*delta[1]);
            const n = dist > 0.0001 ? [delta[0]/dist, delta[1]/dist] : [0, 1];
            return { pos: new Float32Array([pPos[0] + n[0] * pRadius, pPos[1] + n[1] * pRadius]), type: 'particle', targetIdx: nearestP, radius: pRadius };
        }

        // Fallback to static obstacles SDF search
        for (let i = 0; i < this.numObstacles; i++) {
            const off = i * 8;
            const obsPos = new Float32Array([this.obstacles[off]!, this.obstacles[off + 1]!]);
            const rot = this.obstacles[off + 2]!;
            const shapeType = new Uint32Array(this.obstacles.buffer)[off + 3]! & 0xFF;
            const p = [this.obstacles[off + 4]!, this.obstacles[off + 5]!, this.obstacles[off + 6]!, this.obstacles[off + 7]!];

            const s = Math.sin(-rot), c = Math.cos(-rot);
            const dx = pos[0]! - obsPos[0]!;
            const dy = pos[1]! - obsPos[1]!;
            const lpx = dx * c - dy * s;
            const lpy = dx * s + dy * c;

            let d = 1000.0;
            if (shapeType === 0) d = Math.sqrt(lpx*lpx + lpy*lpy) - p[0]!;
            else if (shapeType === 1) {
                const qx = Math.abs(lpx) - (p[0]! * 0.5), qy = Math.abs(lpy) - (p[1]! * 0.5);
                d = Math.max(qx, 0) + Math.max(qy, 0) + Math.min(Math.max(qx, qy), 0);
            }

            if (d < 0.8) {
                const h = 0.001;
                const getD = (lx: number, ly: number) => {
                    if (shapeType === 0) return Math.sqrt(lx*lx + ly*ly) - p[0]!;
                    const qx = Math.abs(lx) - (p[0]! * 0.5), qy = Math.abs(ly) - (p[1]! * 0.5);
                    return Math.max(qx, 0) + Math.max(qy, 0) + Math.min(Math.max(qx, qy), 0);
                };
                const localN = [ (getD(lpx+h, lpy)-d)/h, (getD(lpx, lpy+h)-d)/h ];
                const mag = Math.sqrt(localN[0]!**2 + localN[1]!**2);
                const wn = [ (localN[0]!/mag)*Math.cos(rot)-(localN[1]!/mag)*Math.sin(rot), (localN[0]!/mag)*Math.sin(rot)+(localN[1]!/mag)*Math.cos(rot) ];
                return { pos: new Float32Array([pos[0]! - wn[0]! * d, pos[1]! - wn[1]! * d]), type: 'static', radius: 0 };
            }
        }

        // Fallback to world bounds
        const bx = 11.8, by = 6.8;
        if (Math.abs(pos[0]!) > bx || Math.abs(pos[1]!) > by) {
            return { pos: new Float32Array([Math.max(-bx, Math.min(bx, pos[0]!)), Math.max(-by, Math.min(by, pos[1]!))]), type: 'static', radius: 0 };
        }
        return null;
    }

    updateQueries(params: SimulationParams) {
        if (!this.ready || this.isQueryReadingBack || this.pendingQueries.length === 0) return;

        const batch = this.pendingQueries.splice(0, MAX_QUERIES);
        this.readingQueries = batch.map(b => b.resolve);

        const qData = new Float32Array(batch.length * 12);
        const qU32 = new Uint32Array(qData.buffer);
        for(let i=0; i<batch.length; i++) {
            const b = batch[i]!, off = i * 12;
            qU32[off] = b.type; qU32[off+1] = b.mask;
            qData[off+4] = b.origin[0]!; qData[off+5] = b.origin[1]!;
            qData[off+6] = b.dirOrRadius[0]!; qData[off+7] = b.dirOrRadius[1]!;
            qData[off+8] = b.maxDist;
        }
        this.device.queue.writeBuffer(this.queryBuffer, 0, qData);

        const data = new Float32Array(16);
        new Uint32Array(data.buffer).set([0, 0, 0, 0, 0, 0, 0, 0, 0, this.numObstacles, params.isPaused?1:0, 0, 0, 0, 0, batch.length]);
        this.device.queue.writeBuffer(this.paramsBuffers[0]!, 0, data);

        const enc = this.device.createCommandEncoder();
        const pCmd = enc.beginComputePass();
        pCmd.setBindGroup(0, this.bindGroups[0]!); pCmd.setPipeline(this.pipelines['processQueries']!); pCmd.dispatchWorkgroups(Math.ceil(batch.length / 64));
        pCmd.end();

        enc.copyBufferToBuffer(this.queryResultBuffer, 0, this.queryStagingBuffer, 0, batch.length * 96);
        this.device.queue.submit([enc.finish()]);

        this.isQueryReadingBack = true;
        this.queryStagingBuffer.mapAsync(GPUMapMode.READ).then(() => {
            try {
                const resData = new ArrayBuffer(batch.length * 96);
                new Uint8Array(resData).set(new Uint8Array(this.queryStagingBuffer.getMappedRange(), 0, batch.length * 96));
                this.queryStagingBuffer.unmap();
                
                const rU32 = new Uint32Array(resData), rI32 = new Int32Array(resData), rF32 = new Float32Array(resData);
                for(let i=0; i<this.readingQueries.length; i++) {
                    const off = i * 24, count = rU32[off]!, hits = [];
                    for (let k = 0; k < count; k++) hits.push(rI32[off + 8 + k]!);
                    this.readingQueries[i]!({
                        count, hitType: rU32[off+1]!, hitIdx: rI32[off+2]!, distance: rF32[off+3]!,
                        hitPos: new Float32Array([rF32[off+4]!, rF32[off+5]!]), hitNormal: new Float32Array([rF32[off+6]!, rF32[off+7]!]), hits
                    });
                }
            } finally {
                this.isQueryReadingBack = false; this.readingQueries = [];
            }
        }).catch(() => { this.isQueryReadingBack = false; });
    }

    step(params: SimulationParams) {
        if (!this.ready) return;

        const currentCommands = this.numCommands;
        if (currentCommands > 0) {
            this.device.queue.writeBuffer(this.commandBuffer, 0, this.commandQueue, 0, currentCommands * 48);
            this.numCommands = 0;
        }

        const writeParams = (ph: number) => {
            const data = new Float32Array(16), u32 = new Uint32Array(data.buffer);
            data[0] = params.dt; u32[1] = params.substeps; data[2] = params.gravity[0]!; data[3] = params.gravity[1]!;
            data[4] = params.worldBounds[0]!; data[5] = params.worldBounds[1]!; data[6] = params.worldBounds[2]!; data[7] = params.worldBounds[3]!;
            u32[8] = params.collisionIterations; u32[9] = this.numObstacles; u32[10] = params.isPaused ? 1 : 0; u32[11] = ph; u32[12] = currentCommands;
            this.device.queue.writeBuffer(this.paramsBuffers[ph]!, 0, data);
        };

        const enc = this.device.createCommandEncoder();
        writeParams(0);

        if (currentCommands > 0) {
            const pCmd = enc.beginComputePass();
            pCmd.setBindGroup(0, this.bindGroups[0]!); pCmd.setPipeline(this.pipelines['processCommands']!); pCmd.dispatchWorkgroups(Math.ceil(currentCommands / 64));
            pCmd.end();
        }

        const pGridClear = enc.beginComputePass();
        pGridClear.setBindGroup(0, this.bindGroups[0]!); pGridClear.setPipeline(this.pipelines['clearGrid']!); pGridClear.dispatchWorkgroups(Math.ceil(4096 / 64));
        pGridClear.end();

        const pGridBuild = enc.beginComputePass();
        pGridBuild.setBindGroup(0, this.bindGroups[0]!); pGridBuild.setPipeline(this.pipelines['buildGrid']!); pGridBuild.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / 64));
        pGridBuild.end();

        const pInt = enc.beginComputePass(); pInt.setBindGroup(0, this.bindGroups[0]!); pInt.setPipeline(this.pipelines['integrate']!); pInt.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / 64)); pInt.end();

        for (let s = 0; s < params.substeps; s++) {
            for (let ph = 0; ph <= this.maxColor; ph++) {
                writeParams(ph);
                const pConstr = enc.beginComputePass(); 
                pConstr.setBindGroup(0, this.bindGroups[ph]!); 
                pConstr.setPipeline(this.pipelines['solveConstraints']!); 
                pConstr.dispatchWorkgroups(Math.ceil(MAX_CONSTRAINTS / 64)); 
                pConstr.end();
            }
            
            const pColl = enc.beginComputePass(); 
            pColl.setBindGroup(0, this.bindGroups[0]!); 
            pColl.setPipeline(this.pipelines['solveCollisions']!); 
            pColl.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / 64)); 
            pColl.end();

            const pPColl = enc.beginComputePass(); 
            pPColl.setBindGroup(0, this.bindGroups[0]!); 
            pPColl.setPipeline(this.pipelines['solveParticleCollisions']!); 
            pPColl.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / 64)); 
            pPColl.end();

            const pFric = enc.beginComputePass(); 
            pFric.setBindGroup(0, this.bindGroups[0]!); 
            pFric.setPipeline(this.pipelines['applyFriction']!); 
            pFric.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / 64)); 
            pFric.end();

            const pPFric = enc.beginComputePass(); 
            pPFric.setBindGroup(0, this.bindGroups[0]!); 
            pPFric.setPipeline(this.pipelines['applyParticleFriction']!); 
            pPFric.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / 64)); 
            pPFric.end();
        }

        if (!this.isReadingBack) {
            enc.copyBufferToBuffer(this.particleBuffer, 0, this.stagingBuffer, 0, this.particles.byteLength);
            this.device.queue.submit([enc.finish()]);
            this.isReadingBack = true;
            this.stagingBuffer.mapAsync(GPUMapMode.READ).then(() => {
                try {
                    const data = new Float32Array(this.stagingBuffer.getMappedRange());
                    for (const i of this.activeParticleIndices) {
                        const off = i * 8;
                        this.particles[off] = data[off]!; this.particles[off+1] = data[off+1]!; 
                        this.particles[off+2] = data[off+2]!; this.particles[off+3] = data[off+3]!;
                    }
                    this.stagingBuffer.unmap();
                } finally { this.isReadingBack = false; }
            }).catch(() => { this.isReadingBack = false; });
        } else {
            this.device.queue.submit([enc.finish()]);
        }
    }
}
