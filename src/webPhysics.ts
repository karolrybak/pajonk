import * as THREE from 'three';
import { world, type Entity } from './ecs';

export const CONFIG = {
    SEGMENT_LENGTH: 0.08,
    ROPE_NODE_MASS: 1.0,
    ROPE_COMPLIANCE: 0.00001,
    VELOCITY_DAMPING: 0.9995,
    GRAVITY: -40.0
};

const MAX_PARTICLES = 16384;
const MAX_CONSTRAINTS = 16384;
const MAX_ATTACHMENTS = 4096;
const MAX_OBSTACLES = 256;

export class WebPhysics {
    renderer: any; scene: THREE.Scene; bounds: { width: number; height: number }; ready: boolean = false; paused: boolean = false;
    particles = new Float32Array(MAX_PARTICLES * 8);
    particleActive = new Uint8Array(MAX_PARTICLES);
    distConstraints = new Float32Array(MAX_CONSTRAINTS * 8);
    constraintVisible = new Uint8Array(MAX_CONSTRAINTS);
    attachments = new Float32Array(MAX_ATTACHMENTS * 4);
    obstacles = new Float32Array(MAX_OBSTACLES * 8);

    numParticles = 0; numDistConstraints = 0; numAttachments = 0; numObstacles = 0;
    ropes: any[] = []; activeRope: any = null;
    dirtyParticles = new Set<number>(); freeParticleIndices: number[] = []; freeConstraintIndices: number[] = [];

    particleColors = Array.from({length: MAX_PARTICLES}, () => new Set<number>());
    colorCounts = new Int32Array(16);
    maxColor = 0;
    maxPhases = 16;

    device: GPUDevice | null = null;
    particleBuffer: GPUBuffer | null = null; distConstraintBuffer: GPUBuffer | null = null;
    attachmentBuffer: GPUBuffer | null = null; obstacleBuffer: GPUBuffer | null = null;
    stagingBuffer: GPUBuffer | null = null;
    paramsBuffers: GPUBuffer[] = [];
    bindGroups: GPUBindGroup[] = [];
    pipelines: Record<string, GPUComputePipeline> = {}; isReadingBack = false;

    dragParticleIdx: number = -1;
    constraintLines: THREE.LineSegments | null = null;

    constructor(renderer: any, scene: THREE.Scene, bounds: { width: number; height: number }) {
        this.renderer = renderer; this.scene = scene; this.bounds = bounds;
    }

    async init() {
        const device = this.renderer.device || this.renderer.backend?.device;
        if (!device) throw new Error('WebGPU device not found');
        this.device = device;

        const shaderCode = await (await fetch('/src/physics.wgsl')).text();
        const shaderModule = device.createShaderModule({ code: shaderCode });

        this.particleBuffer = device.createBuffer({ size: this.particles.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
        this.distConstraintBuffer = device.createBuffer({ size: this.distConstraints.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.attachmentBuffer = device.createBuffer({ size: this.attachments.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.obstacleBuffer = device.createBuffer({ size: this.obstacles.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

        this.stagingBuffer = device.createBuffer({ size: this.particles.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

        const bgl = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }
            ]
        });

        for (let i = 0; i < this.maxPhases; i++) {
            const pBuf = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            this.paramsBuffers.push(pBuf);
            this.bindGroups.push(device.createBindGroup({
                layout: bgl,
                entries: [
                    { binding: 0, resource: { buffer: this.particleBuffer! } },
                    { binding: 1, resource: { buffer: this.distConstraintBuffer! } },
                    { binding: 2, resource: { buffer: this.attachmentBuffer! } },
                    { binding: 3, resource: { buffer: pBuf } },
                    { binding: 4, resource: { buffer: this.obstacleBuffer! } }
                ]
            }));
        }
        const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
        const createPipe = (entry: string) => device.createComputePipeline({ layout, compute: { module: shaderModule, entryPoint: entry } });

        ['integrate', 'solveDistance', 'solveAttachments', 'solveParticleCollisions', 'solveCollisions'].forEach(e => this.pipelines[e] = createPipe(e));
        
        const constraintGeo = new THREE.BufferGeometry();
        constraintGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_CONSTRAINTS * 6), 3));
        this.constraintLines = new THREE.LineSegments(constraintGeo, new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.8 }));
        this.scene.add(this.constraintLines);
        
        this.ready = true;
    }

    syncObstacles() {
        const statics = world.with('sdfCollider', 'position');
        let count = 0;
        this.obstacles.fill(0);
        for (const ent of statics) {
            if (count >= MAX_OBSTACLES) break;
            const off = count * 8;
            this.obstacles[off] = ent.position.x;
            this.obstacles[off + 1] = ent.position.y;
            this.obstacles[off + 2] = ent.sdfCollider.size.x;
            this.obstacles[off + 3] = ent.sdfCollider.size.y;
            const uv = new Uint32Array(this.obstacles.buffer);
            const typeMap: Record<string, number> = { 'circle': 0, 'box': 1, 'rounded_box': 2, 'capsule': 3, 'vesica': 4 };
            uv[off + 4] = typeMap[ent.sdfCollider.type] || 0;
            this.obstacles[off + 5] = ent.rotation;
            this.obstacles[off + 6] = ent.scale.x; 
            this.obstacles[off + 7] = ent.friction ?? 0.5;
            count++;
        }
        this.numObstacles = count;
        this.device?.queue.writeBuffer(this.obstacleBuffer!, 0, this.obstacles);
    }

    allocParticle() { 
        if (this.numParticles >= MAX_PARTICLES && this.freeParticleIndices.length === 0) return -1;
        const idx = this.freeParticleIndices.length > 0 ? this.freeParticleIndices.pop()! : this.numParticles++; 
        this.particleActive[idx] = 1;
        return idx;
    }
    freeParticle(idx: number) { 
        this.particleColors[idx].clear();
        this.freeParticleIndices.push(idx); 
        this.particleActive[idx] = 0;
        this.setParticle(idx, new THREE.Vector2(0,0), 0); 
    }
    allocConstraint() { 
        if (this.numDistConstraints >= MAX_CONSTRAINTS && this.freeConstraintIndices.length === 0) return -1;
        const idx = this.freeConstraintIndices.length > 0 ? this.freeConstraintIndices.pop()! : this.numDistConstraints++; 
        this.constraintVisible[idx] = 1;
        return idx;
    }
    assignColor(a: number, b: number): number {
        let color = 0;
        const setA = this.particleColors[a];
        const setB = this.particleColors[b];
        while (setA.has(color) || setB.has(color)) color++;
        if (color >= this.maxPhases) color = this.maxPhases - 1;
        setA.add(color); setB.add(color);
        this.colorCounts[color]++;
        while (this.maxColor < 15 && this.colorCounts[this.maxColor + 1] > 0) this.maxColor++;
        return color;
    }
    removeConstraintColor(idx: number) {
        const off = idx * 8;
        const uv = new Uint32Array(this.distConstraints.buffer);
        const a = uv[off], b = uv[off+1], color = uv[off+4];
        this.particleColors[a]?.delete(color);
        this.particleColors[b]?.delete(color);
        this.colorCounts[color]--;
        if (this.colorCounts[color] < 0) this.colorCounts[color] = 0;
        while (this.maxColor > 0 && this.colorCounts[this.maxColor] === 0) this.maxColor--;
    }
    freeConstraint(idx: number) { 
        this.removeConstraintColor(idx);
        this.freeConstraintIndices.push(idx); 
        this.setDistConstraint(idx, 0,0,0,0,0); 
    }

    setParticle(i: number, pos: THREE.Vector2, invMass: number, friction: number = 0.5) {
        const off = i * 8; 
        this.particles[off] = pos.x; 
        this.particles[off+1] = pos.y; 
        this.particles[off+2] = pos.x; 
        this.particles[off+3] = pos.y; 
        this.particles[off+4] = 0.0; 
        this.particles[off+5] = friction; 
        this.particles[off+6] = invMass; 
        this.particles[off+7] = 0.04; 
        this.dirtyParticles.add(i);
    }
    
    setParticleFriction(i: number, friction: number) {
        this.particles[i * 8 + 5] = friction;
        this.dirtyParticles.add(i);
    }

    setParticleInvMass(i: number, invMass: number) {
        this.particles[i * 8 + 6] = invMass;
        this.dirtyParticles.add(i);
    }
    
    setParticleFree(i: number, isFree: boolean) {
        this.particles[i * 8 + 4] = isFree ? 1.0 : 0.0;
        this.dirtyParticles.add(i);
    }

    setParticlePos(i: number, pos: THREE.Vector2) {
        const off = i * 8; this.particles[off] = pos.x; this.particles[off+1] = pos.y; this.particles[off+2] = pos.x; this.particles[off+3] = pos.y; 
        this.dirtyParticles.add(i);
    }
    setDistConstraint(i: number, a: number, b: number, len: number, comp: number, color: number = 0) {
        const off = i * 8; const uv = new Uint32Array(this.distConstraints.buffer); 
        uv[off] = a; uv[off+1] = b; this.distConstraints[off+2] = len; this.distConstraints[off+3] = comp;
        uv[off+4] = color; uv[off+5] = 0; uv[off+6] = 0; uv[off+7] = 0;
    }
    addAttachment(pIdx: number, aIdx: number, bIdx: number, t: number) {
        const off = this.numAttachments * 4; const uv = new Uint32Array(this.attachments.buffer); uv[off] = pIdx; uv[off+1] = aIdx; uv[off+2] = bIdx; this.attachments[off+3] = t; this.numAttachments++;
    }
    syncGPU() { 
        this.device?.queue.writeBuffer(this.particleBuffer!, 0, this.particles);
        this.device?.queue.writeBuffer(this.distConstraintBuffer!, 0, this.distConstraints);
        this.device?.queue.writeBuffer(this.attachmentBuffer!, 0, this.attachments);
    }

    update(mousePos: THREE.Vector2) {
        if (!this.ready || this.isReadingBack) return;
        const dt = 1/60, subs = 8;
        
        const activeIdx = this.dragParticleIdx !== -1 ? this.dragParticleIdx : (this.activeRope ? this.activeRope.indices[this.activeRope.indices.length-1] : -1);

        const fill = (ph: number) => {
            const b = new ArrayBuffer(96), f = new Float32Array(b), u = new Uint32Array(b), i = new Int32Array(b);
            f[0] = dt; f[1] = CONFIG.GRAVITY; u[2] = this.numParticles; u[3] = this.numDistConstraints; u[4] = subs; u[5] = ph; f[6] = mousePos.x; f[7] = mousePos.y; i[8] = activeIdx; u[9] = this.numAttachments; f[10] = CONFIG.VELOCITY_DAMPING; u[11] = this.paused ? 1 : 0; u[12] = this.numObstacles;
            return b;
        };
        for (let ph = 0; ph <= this.maxColor; ph++) {
            this.device?.queue.writeBuffer(this.paramsBuffers[ph], 0, fill(ph));
        }
        const enc = this.device!.createCommandEncoder();
        
        for (let s = 0; s < subs; s++) {
            const p1 = enc.beginComputePass(); p1.setBindGroup(0, this.bindGroups[0]); p1.setPipeline(this.pipelines.integrate!); p1.dispatchWorkgroups(Math.ceil(this.numParticles/64)); p1.end();
            for (let i = 0; i < 4; i++) {
                for (let ph = 0; ph <= this.maxColor; ph++) {
                    const d = enc.beginComputePass(); d.setBindGroup(0, this.bindGroups[ph]); d.setPipeline(this.pipelines.solveDistance!); d.dispatchWorkgroups(Math.ceil(this.numDistConstraints/64)); d.end();
                }
                const at = enc.beginComputePass(); at.setBindGroup(0, this.bindGroups[0]); at.setPipeline(this.pipelines.solveAttachments!); at.dispatchWorkgroups(Math.ceil(this.numAttachments/64)); at.end();
            }
            const c0 = enc.beginComputePass(); c0.setBindGroup(0, this.bindGroups[0]); c0.setPipeline(this.pipelines.solveParticleCollisions!); c0.dispatchWorkgroups(Math.ceil(this.numParticles/64)); c0.end();
            const c1 = enc.beginComputePass(); c1.setBindGroup(0, this.bindGroups[0]); c1.setPipeline(this.pipelines.solveCollisions!); c1.dispatchWorkgroups(Math.ceil(this.numParticles/64)); c1.end();
        }
        
        enc.copyBufferToBuffer(this.particleBuffer!, 0, this.stagingBuffer!, 0, this.particles.byteLength);
        this.device?.queue.submit([enc.finish()]);
        this.readBackAndVisualize();
    }

    readBackAndVisualize() {
        if (!this.stagingBuffer || this.isReadingBack) return;
        this.isReadingBack = true;
        this.stagingBuffer.mapAsync(GPUMapMode.READ).then(() => {
            const data = new Float32Array(this.stagingBuffer!.getMappedRange());
            const dirty = Array.from(this.dirtyParticles).map(i => ({i, data: this.particles.slice(i*8, i*8+8)}));
            this.particles.set(data); dirty.forEach(b => this.particles.set(b.data, b.i*8)); this.dirtyParticles.clear();
            this.stagingBuffer!.unmap(); this.isReadingBack = false; this.updateVisuals();
        }).catch(() => this.isReadingBack = false);
    }

    updateVisuals() {
        if (this.constraintLines) {
            const posAttr = this.constraintLines.geometry.getAttribute('position');
            let drawCount = 0;
            const uv = new Uint32Array(this.distConstraints.buffer);
            for(let i=0; i<this.numDistConstraints; i++) {
                if (this.constraintVisible[i] === 0) continue;
                const a = uv[i*8], b = uv[i*8+1];
                if (a === b) continue;
                posAttr.setXYZ(drawCount*2, this.particles[a*8], this.particles[a*8+1], 0);
                posAttr.setXYZ(drawCount*2+1, this.particles[b*8], this.particles[b*8+1], 0);
                drawCount++;
            }
            this.constraintLines.geometry.setDrawRange(0, drawCount*2);
            posAttr.needsUpdate = true;
        }

        const dynamics = world.with('physics', 'renderable');
        for (const ent of dynamics) {
            if (ent.physics.particleIdx !== undefined) {
                const off = ent.physics.particleIdx * 8;
                ent.position.set(this.particles[off], this.particles[off + 1]);
                ent.renderable.mesh.position.set(ent.position.x, ent.position.y, -0.1);
            }
        }
    }

    getParticlePos(i: number) { return new THREE.Vector2(this.particles[i*8], this.particles[i*8+1]); }
    
    getNearestParticle(pos: THREE.Vector2, maxDist: number) {
        let nearest = -1;
        let minDistSq = maxDist * maxDist;
        for (let i = 0; i < this.numParticles; i++) {
            if (!this.particleActive[i]) continue;
            const px = this.particles[i*8], py = this.particles[i*8+1];
            const distSq = (px - pos.x)**2 + (py - pos.y)**2;
            if (distSq < minDistSq) {
                minDistSq = distSq;
                nearest = i;
            }
        }
        return nearest;
    }

    findIntersectingConstraint(pos: THREE.Vector2, radius: number) {
        const uv = new Uint32Array(this.distConstraints.buffer);
        let closest = -1;
        let minDist = radius;
        const bestProj = new THREE.Vector2();
        for(let i=0; i<this.numDistConstraints; i++) {
            if (this.constraintVisible[i] === 0) continue;
            const a = uv[i*8], b = uv[i*8+1];
            if (a === b) continue;
            const pA = new THREE.Vector2(this.particles[a*8], this.particles[a*8+1]);
            const pB = new THREE.Vector2(this.particles[b*8], this.particles[b*8+1]);
            const l2 = pA.distanceToSquared(pB);
            if (l2 === 0) continue;
            let t = ((pos.x - pA.x) * (pB.x - pA.x) + (pos.y - pA.y) * (pB.y - pA.y)) / l2;
            t = Math.max(0, Math.min(1, t));
            const proj = new THREE.Vector2(pA.x + t * (pB.x - pA.x), pA.y + t * (pB.y - pA.y));
            const d = pos.distanceTo(proj);
            if (d < minDist) {
                minDist = d;
                closest = i;
                bestProj.copy(proj);
            }
        }
        return closest !== -1 ? { index: closest, proj: bestProj } : null;
    }

    createJoint(a: number, b: number) {
        const cIdx = this.allocConstraint();
        if (cIdx === -1) return;
        const pA = this.getParticlePos(a);
        const pB = this.getParticlePos(b);
        const dist = pA.distanceTo(pB);
        const color = this.assignColor(a, b);
        this.setDistConstraint(cIdx, a, b, dist, 0.000001, color);
        this.syncGPU();
        this.updateVisuals();
    }

    findAnchor(pos: THREE.Vector2, ignoreIndices?: number[]): any {
        const bx=11.8, by=6.8, th=0.5;
        if (Math.abs(pos.x)>bx-th || Math.abs(pos.y)>by-th) return { pos: pos.clone().clamp(new THREE.Vector2(-bx,-by), new THREE.Vector2(bx,by)), type: 'static' };
        
        const ignoreSet = new Set(ignoreIndices || []);

        let pIdx = -1;
        let minDistSq = 1.0;
        for (let i = 0; i < this.numParticles; i++) {
            if (!this.particleActive[i] || ignoreSet.has(i)) continue;
            const px = this.particles[i*8], py = this.particles[i*8+1];
            const distSq = (px - pos.x)**2 + (py - pos.y)**2;
            if (distSq < minDistSq) {
                minDistSq = distSq;
                pIdx = i;
            }
        }

        if (pIdx !== -1) {
            const ent = [...world.entities].find(e => e.physics?.particleIdx === pIdx);
            if (!ent || ent.attachable) {
                const pPos = this.getParticlePos(pIdx);
                const radius = this.particles[pIdx*8+7];
                const nodeRadius = 0.04;
                const dir = pos.clone().sub(pPos);
                if (dir.lengthSq() === 0) dir.set(1, 0);
                dir.normalize();
                const surfacePos = pPos.clone().add(dir.multiplyScalar(radius + nodeRadius));
                return { pos: surfacePos, type: 'particle', targetIdx: pIdx, distance: radius + nodeRadius };
            }
        }

        const statics = world.with('sdfCollider', 'position');
        const staticArr = [...statics];

        for (let i = 0; i < this.numObstacles; i++) {
            const ent = staticArr[i];
            if (ent && !ent.attachable) continue;

            const off = i * 8;
            const obsPos = new THREE.Vector2(this.obstacles[off], this.obstacles[off+1]);
            const obsSize = new THREE.Vector2(this.obstacles[off+2], this.obstacles[off+3]);
            const type = new Uint32Array(this.obstacles.buffer)[off+4];
            
            if (type === 0) {
                if (pos.distanceTo(obsPos) < obsSize.x + th) {
                    const dir = pos.clone().sub(obsPos);
                    if (dir.lengthSq() === 0) dir.set(1, 0);
                    const surfacePos = obsPos.clone().add(dir.normalize().multiplyScalar(obsSize.x));
                    return { pos: surfacePos, type: 'static' };
                }
            } else {
                const rotation = this.obstacles[off+5];
                const s = Math.sin(-rotation);
                const c = Math.cos(-rotation);
                const dx = pos.x - obsPos.x;
                const dy = pos.y - obsPos.y;
                const localX = dx * c - dy * s;
                const localY = dx * s + dy * c;

                const half = obsSize.clone().multiplyScalar(0.5);
                const d = new THREE.Vector2(Math.abs(localX) - half.x, Math.abs(localY) - half.y);
                if (Math.max(d.x, d.y) < th) {
                    let attachX = localX;
                    let attachY = localY;
                    if (Math.abs(localX) / half.x > Math.abs(localY) / half.y) {
                        attachX = Math.sign(localX || 1) * half.x;
                    } else {
                        attachY = Math.sign(localY || 1) * half.y;
                    }
                    
                    const sr = Math.sin(rotation);
                    const cr = Math.cos(rotation);
                    const worldAttachX = obsPos.x + attachX * cr - attachY * sr;
                    const worldAttachY = obsPos.y + attachX * sr + attachY * cr;

                    return { pos: new THREE.Vector2(worldAttachX, worldAttachY), type: 'static' };
                }
            }
        }
        
        return null;
    }

    createRope(anchor: any) {
        const idxA = this.allocParticle(); if (idxA === -1) return null;
        const idxB = this.allocParticle(); if (idxB === -1) { this.freeParticle(idxA); return null; }
        const cIdx = this.allocConstraint(); if (cIdx === -1) { this.freeParticle(idxA); this.freeParticle(idxB); return null; }
        const indices = [idxA, idxB];
        this.setParticle(idxA, anchor.pos, anchor.type==='static'?0:1/CONFIG.ROPE_NODE_MASS); 
        this.setParticle(idxB, anchor.pos, 1/CONFIG.ROPE_NODE_MASS);
        
        this.setParticleFree(idxA, true);
        this.setParticleFree(idxB, true);
        
        const rope = { indices, constraintIndices: [cIdx], anchorConstraints: [] as number[], segments: 1, segmentLength: CONFIG.SEGMENT_LENGTH };

        if (anchor.type==='particle') {
            const extraC = this.allocConstraint();
            if (extraC !== -1) {
                this.constraintVisible[extraC] = 0;
                const extraColor = this.assignColor(idxA, anchor.targetIdx);
                this.setDistConstraint(extraC, idxA, anchor.targetIdx, anchor.distance + 0.02, 0, extraColor);
                rope.anchorConstraints.push(extraC);
            }
        }
        
        const color = this.assignColor(idxA, idxB);
        this.setDistConstraint(cIdx, idxA, idxB, CONFIG.SEGMENT_LENGTH, CONFIG.ROPE_COMPLIANCE, color);
        this.ropes.push(rope); this.activeRope = rope; this.syncGPU(); return rope;
    }

    pinActiveRope(rope: any, anchor: any) {
        const last = rope.indices[rope.indices.length-1]; 
        this.setParticle(last, anchor.pos, anchor.type==='static'?0:1/CONFIG.ROPE_NODE_MASS);
        
        if (anchor.type==='particle') {
            const extraC = this.allocConstraint();
            if (extraC !== -1) {
                this.constraintVisible[extraC] = 0;
                const color = this.assignColor(last, anchor.targetIdx);
                this.setDistConstraint(extraC, last, anchor.targetIdx, anchor.distance + 0.02, 0, color);
                rope.anchorConstraints.push(extraC);
            }
        }
        
        rope.indices.forEach((idx: number) => this.setParticleFree(idx, false));
        this.activeRope = null; 
        this.syncGPU();
    }

    freeActiveRope() {
        if (!this.activeRope) return;
        const rope = this.activeRope;
        rope.indices.forEach((idx: number) => this.setParticleFree(idx, false));
        this.activeRope = null;
        this.syncGPU();
    }

    adjustRopeLength(rope: any, delta: number) {
        const SEG = CONFIG.SEGMENT_LENGTH;
        if (delta < 0 && rope.indices.length < 500) {
            const tail = rope.indices[rope.indices.length-1];
            const prev = rope.indices[rope.indices.length-2];
            
            const tailPos = this.getParticlePos(tail);
            const prevPos = this.getParticlePos(prev);
            
            const newIdx = this.allocParticle(); 
            if (newIdx === -1) return;

            const dir = tailPos.clone().sub(prevPos);
            const dist = dir.length();
            const step = dist > 0 ? dir.normalize().multiplyScalar(Math.min(dist * 0.5, SEG)) : new THREE.Vector2(SEG, 0);
            
            this.setParticle(newIdx, prevPos.clone().add(step), 1/CONFIG.ROPE_NODE_MASS);
            this.setParticleFree(newIdx, true);
            
            const lastC = rope.constraintIndices[rope.constraintIndices.length-1]; 
            this.removeConstraintColor(lastC);
            const color1 = this.assignColor(prev, newIdx);
            this.setDistConstraint(lastC, prev, newIdx, SEG, CONFIG.ROPE_COMPLIANCE, color1);
            
            const newC = this.allocConstraint(); 
            if (newC === -1) {
                this.freeParticle(newIdx);
                this.removeConstraintColor(lastC);
                const colorRestore = this.assignColor(prev, tail);
                this.setDistConstraint(lastC, prev, tail, SEG, CONFIG.ROPE_COMPLIANCE, colorRestore);
                return;
            }
            const color2 = this.assignColor(newIdx, tail);
            rope.constraintIndices.push(newC); 
            this.setDistConstraint(newC, newIdx, tail, SEG, CONFIG.ROPE_COMPLIANCE, color2);
            
            rope.indices.splice(rope.indices.length - 1, 0, newIdx);
            rope.segments++; 
            this.syncGPU();
        } else if (delta > 0 && rope.indices.length > 2) {
            const tail = rope.indices.pop()!; 
            const rem = rope.indices.pop()!; 
            rope.indices.push(tail); 
            this.freeParticle(rem);
            
            const remC = rope.constraintIndices.pop()!; 
            this.freeConstraint(remC);
            
            const lastC = rope.constraintIndices[rope.constraintIndices.length-1]; 
            this.removeConstraintColor(lastC);
            const prev = rope.indices[rope.indices.length-2];
            const colorRestored = this.assignColor(prev, tail);
            this.setDistConstraint(lastC, prev, tail, SEG, CONFIG.ROPE_COMPLIANCE, colorRestored); 
            rope.segments--; 
            this.syncGPU();
        }
    }

    spawnBall(pos: THREE.Vector2, bodyType: 'dynamic' | 'static' | 'kinematic' = 'dynamic', radius = 0.5, mass = 10.0) {
        const idx = this.allocParticle(); if (idx===-1) return -1;
        const invMass = bodyType === 'dynamic' ? 1.0 / mass : 0;
        this.setParticle(idx, pos, invMass); 
        this.particles[idx*8+7] = radius;
        this.syncGPU();
        return idx;
    }
}
