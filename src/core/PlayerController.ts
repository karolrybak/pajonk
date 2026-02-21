import * as THREE from 'three';
import type { Entity } from '../ecs';
import { WebPhysics } from '../webPhysics';

export class PlayerController {
    private keys = new Set<string>();
    private mousePos = new THREE.Vector2();
    
    moveDir = new THREE.Vector2();
    aimDir = new THREE.Vector2();
    jumpPressed = false;
    shootPressed = false;

    torso: Entity;
    head: Entity;

    constructor(public parts: Entity[], public physics: WebPhysics) {
        this.torso = parts.find(p => p.playerPart?.role === 'torso') || parts[0];
        this.head = parts.find(p => p.playerPart?.role === 'head') || parts[1];

        window.addEventListener('keydown', (e) => this.keys.add(e.code));
        window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    }

    update(mouseWorld: THREE.Vector2) {
        this.mousePos.copy(mouseWorld);
        this.pollKeyboard();
        this.pollGamepad();
        this.applyToPhysics();
    }

    private pollKeyboard() {
        this.moveDir.set(0, 0);
        if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.moveDir.y += 1;
        if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.moveDir.y -= 1;
        if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.moveDir.x -= 1;
        if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.moveDir.x += 1;
        
        if (this.moveDir.lengthSq() > 0) this.moveDir.normalize();
        this.aimDir.copy(this.mousePos).sub(this.torso.position).normalize();
        this.jumpPressed = this.keys.has('Space');
    }

    private pollGamepad() {
        const gamepads = navigator.getGamepads();
        const gp = gamepads[0];
        if (!gp) return;

        const lx = gp.axes[0] ?? 0;
        const ly = -(gp.axes[1] ?? 0);
        if (Math.abs(lx) > 0.1 || Math.abs(ly) > 0.1) {
            this.moveDir.set(lx, ly);
        }

        const rx = gp.axes[2] ?? 0;
        const ry = -(gp.axes[3] ?? 0);
        if (Math.abs(rx) > 0.2 || Math.abs(ry) > 0.2) {
            this.aimDir.set(rx, ry).normalize();
        }

        this.jumpPressed = this.jumpPressed || gp.buttons[0]?.pressed;
        this.shootPressed = gp.buttons[7]?.pressed;
    }

    private applyToPhysics() {
        const strength = 1.2;
        
        for (const part of this.parts) {
            if (part.physics?.particleIdx === undefined) continue;
            const pIdx = part.physics.particleIdx;
            const off = pIdx * 8;

            if (this.moveDir.lengthSq() > 0) {
                this.physics.particles[off + 2] -= this.moveDir.x * strength * 0.015;
                this.physics.particles[off + 3] -= this.moveDir.y * strength * 0.015;
                this.physics.dirtyParticles.add(pIdx);
            }
        }
    }
}