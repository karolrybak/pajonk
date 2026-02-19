import * as THREE from 'three';

/**
 * Converts screen mouse coordinates to game world coordinates.
 * @param e The mouse or wheel event.
 * @param container The canvas container element.
 * @param bounds The game world bounds (width/height).
 */
export const getMouseWorld = (
    e: MouseEvent | WheelEvent,
    container: HTMLElement,
    bounds: { width: number; height: number }
): THREE.Vector2 => {
    const rect = container.getBoundingClientRect();
    // Normalize to [-1, 1]
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    // Map to game units
    return new THREE.Vector2(x * (bounds.width / 2), y * (bounds.height / 2));
};