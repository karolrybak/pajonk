import * as THREE from 'three';

export const getMouseWorld = (
    e: MouseEvent | WheelEvent,
    container: HTMLElement,
    bounds: { width: number; height: number }
): THREE.Vector2 => {
    const rect = container.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    return new THREE.Vector2(x * (bounds.width / 2), y * (bounds.height / 2));
};