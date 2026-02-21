import { mat4 } from 'wgpu-matrix';
import { WebPhysics, MAX_PARTICLES, MAX_OBSTACLES, MAX_CONSTRAINTS } from '../webPhysics';
import { BOUNDS } from '../constants';

export class Renderer {
    device: GPUDevice;
    context: GPUCanvasContext;
    format: GPUTextureFormat;
    
    renderPipeline!: GPURenderPipeline;
    linePipeline!: GPURenderPipeline;
    gizmoPipeline!: GPURenderPipeline;
    bindGroup!: GPUBindGroup;
    
    gizmoBuffer: GPUBuffer;

    constructor(device: GPUDevice, canvas: HTMLCanvasElement) {
        this.device = device;
        this.context = canvas.getContext('webgpu')!;
        this.format = navigator.gpu.getPreferredCanvasFormat();
        
        this.context.configure({
            device: this.device,
            format: this.format,
            alphaMode: 'premultiplied'
        });

        this.gizmoBuffer = this.device.createBuffer({
            size: 32, // pos (vec2), color (vec4)
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
    }

    async init(physics: WebPhysics) {
        const shaderCode = await (await fetch(new URL('../materials/render.wgsl', import.meta.url))).text();
        const shaderModule = this.device.createShaderModule({ code: shaderCode });

        const bgl = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
                { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
                { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
                { binding: 4, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
            ]
        });

        const viewProj = mat4.ortho(-BOUNDS.width/2, BOUNDS.width/2, -BOUNDS.height/2, BOUNDS.height/2, -1, 1);
        const vpBuffer = this.device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.device.queue.writeBuffer(vpBuffer, 0, (viewProj as Float32Array).buffer);

        this.bindGroup = this.device.createBindGroup({
            layout: bgl,
            entries: [
                { binding: 0, resource: { buffer: physics.particleBuffer } },
                { binding: 1, resource: { buffer: physics.obstacleBuffer } },
                { binding: 2, resource: { buffer: vpBuffer } },
                { binding: 3, resource: { buffer: physics.constraintBuffer } },
                { binding: 4, resource: { buffer: this.gizmoBuffer } }
            ]
        });

        const layout = this.device.createPipelineLayout({ bindGroupLayouts: [bgl] });

        this.renderPipeline = this.device.createRenderPipeline({
            layout,
            vertex: { module: shaderModule, entryPoint: 'vs' },
            fragment: { module: shaderModule, entryPoint: 'fs', targets: [{ format: this.format, blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
            } }] },
            primitive: { topology: 'triangle-list' }
        });

        this.linePipeline = this.device.createRenderPipeline({
            layout,
            vertex: { module: shaderModule, entryPoint: 'vs_lines' },
            fragment: { module: shaderModule, entryPoint: 'fs_lines', targets: [{ format: this.format, blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
            } }] },
            primitive: { topology: 'line-list' }
        });

        this.gizmoPipeline = this.device.createRenderPipeline({
            layout,
            vertex: { module: shaderModule, entryPoint: 'vs_gizmo' },
            fragment: { module: shaderModule, entryPoint: 'fs_gizmo', targets: [{ format: this.format, blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
            } }] },
            primitive: { topology: 'triangle-list' }
        });
    }

    updateGizmo(pos: Float32Array, color: Float32Array) {
        const data = new Float32Array(8);
        data.set(pos, 0);
        data.set(color, 4);
        this.device.queue.writeBuffer(this.gizmoBuffer, 0, data.buffer);
    }

    render() {
        const commandEncoder = this.device.createCommandEncoder();
        const textureView = this.context.getCurrentTexture().createView();

        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: textureView,
                clearValue: { r: 0.05, g: 0.05, b: 0.05, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        });

        passEncoder.setBindGroup(0, this.bindGroup);

        passEncoder.setPipeline(this.linePipeline);
        passEncoder.draw(2, MAX_CONSTRAINTS, 0, 0);

        passEncoder.setPipeline(this.renderPipeline);
        passEncoder.draw(6, MAX_OBSTACLES, 0, 0);
        passEncoder.draw(6, MAX_PARTICLES, 0, MAX_OBSTACLES);
        
        passEncoder.setPipeline(this.gizmoPipeline);
        passEncoder.draw(6, 1, 0, 0);

        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
}