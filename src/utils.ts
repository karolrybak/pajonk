import { vec2 } from 'wgpu-matrix';

/**
 * Converts screen mouse coordinates to game world coordinates using raw WebGPU context logic.
 */
export const getMouseWorld = (
    e: MouseEvent | WheelEvent,
    container: HTMLElement,
    bounds: { width: number; height: number }
): Float32Array => {
    const rect = container.getBoundingClientRect();
    // Normalize to [-1, 1]
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    // Map to game units
    return new Float32Array([x * (bounds.width / 2), y * (bounds.height / 2)]);
};