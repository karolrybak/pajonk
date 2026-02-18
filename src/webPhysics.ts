import * as THREE from 'three';

const MAX_PARTICLES = 2048;
const MAX_CONSTRAINTS = 2048;

export class WebPhysics {
    renderer: any;
    scene: THREE.Scene;
    bounds: { width: number; height: number };
    ready: boolean;
    particles: Float32Array;
    constraints: Uint32Array;
    numParticles: number;
    numConstraints: number;
    activeRope: any;
    device: any;
    particleBuffer: any;
    constraintBuffer: any;
    paramsBuffer: any;
    bindGroup: any;
    integratePipeline: any;
    solveDistancePipeline: any;
    solveCollisionsPipeline: any;

    constructor(renderer: any, scene: THREE.Scene, bounds: { width: number; height: number }) {
        this.renderer = renderer;
        this.scene = scene;
        this.bounds = bounds;
        this.ready = false;
        
        this.particles = new Float32Array(MAX_PARTICLES * 8);
        this.constraints = new Uint32Array(MAX_CONSTRAINTS * 8);
        
        this.numParticles = 0;
        this.numConstraints = 0;
        this.activeRope = null;
        this.device = null;
        this.particleBuffer = null;
        this.constraintBuffer = null;
        this.paramsBuffer = null;
        this.bindGroup = null;
        this.integratePipeline = null;
        this.solveDistancePipeline = null;
        this.solveCollisionsPipeline = null;
    }

    async init(): Promise<void> {
        // WebGPU device - three.js r182+ exposes it directly
        const device = this.renderer.device || this.renderer.backend?.device;
        
        if (!device) {
            console.error('WebGPU device not available');
            return;
        }
        
        this.device = device;

        const shaderModule = device.createShaderModule({
            code: await (await fetch('/src/physics.wgsl')).text()
        });

        this.particleBuffer = device.createBuffer({
            size: this.particles.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX,
        });

        this.constraintBuffer = device.createBuffer({
            size: this.constraints.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.paramsBuffer = device.createBuffer({
            size: 64,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const bindGroupLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }
            ]
        });

        this.bindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.particleBuffer } },
                { binding: 1, resource: { buffer: this.constraintBuffer } },
                { binding: 2, resource: { buffer: this.paramsBuffer } }
            ]
        });

        const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

        this.integratePipeline = device.createComputePipeline({ layout: pipelineLayout, compute: { module: shaderModule, entryPoint: 'integrate' } });
        this.solveDistancePipeline = device.createComputePipeline({ layout: pipelineLayout, compute: { module: shaderModule, entryPoint: 'solveDistance' } });
        this.solveCollisionsPipeline = device.createComputePipeline({ layout: pipelineLayout, compute: { module: shaderModule, entryPoint: 'solveCollisions' } });

        this.ready = true;
    }

    createRope(startPos: THREE.Vector2): any {
        const startIdx = this.numParticles++;
        const endIdx = this.numParticles++;

        this.setParticle(startIdx, startPos, 0.0);
        this.setParticle(endIdx, startPos, 1.0);

        const cIdx = this.numConstraints++;
        this.setConstraint(cIdx, startIdx, endIdx, 0.5, 0.00001);

        const geo = new THREE.BufferGeometry();
        const mesh = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff }));
        this.scene.add(mesh);

        const rope = { startIdx, endIdx, cIdx, mesh, length: 0.5 };
        this.activeRope = rope;
        return rope;
    }

    pinActiveRope(rope: any, pos: THREE.Vector2): void {
        this.setParticle(rope.endIdx, pos, 0.0);
        this.activeRope = null;
        this.syncGPU();
    }

    adjustRopeLength(rope: any, delta: number): void {
        rope.length = Math.max(0.1, rope.length + delta);
        this.setConstraint(rope.cIdx, rope.startIdx, rope.endIdx, rope.length, 0.00001);
        this.syncGPU();
    }

    setParticle(i: number, pos: THREE.Vector2, invMass: number): void {
        const off = i * 8;
        this.particles[off] = pos.x;
        this.particles[off + 1] = pos.y;
        this.particles[off + 2] = pos.x;
        this.particles[off + 3] = pos.y;
        this.particles[off + 6] = invMass;
        this.particles[off + 7] = 0.05;
    }

    setConstraint(i: number, a: number, b: number, len: number, compliance: number): void {
        const off = i * 8;
        this.constraints[off] = a;
        this.constraints[off + 1] = b;
        const floatView = new Float32Array(this.constraints.buffer);
        floatView[off + 2] = len;
        floatView[off + 3] = compliance;
        this.constraints[off + 4] = 1;
    }

    syncGPU(): void {
        if (!this.device || !this.particleBuffer || !this.constraintBuffer) return;
        this.device.queue.writeBuffer(this.particleBuffer, 0, this.particles);
        this.device.queue.writeBuffer(this.constraintBuffer, 0, this.constraints);
    }

    update(mousePos: THREE.Vector2): void {
        if (!this.ready || !this.device || !this.paramsBuffer) return;
        
        const substeps = 15;
        const dt = 1.0 / 60.0;
        
        const params = new Float32Array(16);
        params[0] = dt;
        params[1] = -9.8;
        params[2] = this.numParticles;
        params[3] = this.numConstraints;
        params[4] = mousePos.x;
        params[5] = mousePos.y;
        params[6] = this.activeRope ? this.activeRope.endIdx : -1;
        params[7] = substeps;
        this.device.queue.writeBuffer(this.paramsBuffer, 0, params);

        const commandEncoder = this.device.createCommandEncoder();
        
        for(let s = 0; s < substeps; s++) {
            const pass = commandEncoder.beginComputePass();
            pass.setBindGroup(0, this.bindGroup!);
            
            pass.setPipeline(this.integratePipeline!);
            pass.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / 64));
            
            pass.setPipeline(this.solveDistancePipeline!);
            pass.dispatchWorkgroups(Math.ceil(MAX_CONSTRAINTS / 64));
            
            pass.setPipeline(this.solveCollisionsPipeline!);
            pass.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / 64));
            
            pass.end();
        }

        const readBuffer = this.device.createBuffer({size: this.particles.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST});
        commandEncoder.copyBufferToBuffer(this.particleBuffer!, 0, readBuffer, 0, this.particles.byteLength);
        
        this.device.queue.submit([commandEncoder.finish()]);
        this.readBackAndVisualize();
    }

    async readBackAndVisualize(): Promise<void> {
        if (!this.device) return;

        const readBuffer = this.device.createBuffer({
            size: this.particles.byteLength,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
        });
        
        const commandEncoder = this.device.createCommandEncoder();
        commandEncoder.copyBufferToBuffer(this.particleBuffer!, 0, readBuffer, 0, this.particles.byteLength);
        this.device.queue.submit([commandEncoder.finish()]);

        await readBuffer.mapAsync(GPUMapMode.READ);
        const arrayBuffer = readBuffer.getMappedRange();
        this.particles.set(new Float32Array(arrayBuffer));
        readBuffer.unmap();

        if (this.activeRope) {
            const p1 = this.activeRope.startIdx * 8;
            const p2 = this.activeRope.endIdx * 8;
            const pts = new Float32Array([
                this.particles[p1]!, this.particles[p1+1]!, 0,
                this.particles[p2]!, this.particles[p2+1]!, 0
            ]);
            this.activeRope.mesh.geometry.setAttribute('position', new THREE.BufferAttribute(pts, 3));
        }
    }
}
