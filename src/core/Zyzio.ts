import * as THREE from 'three';
import { WebPhysics } from '../webPhysics';

export class Zyzio {
    physics: WebPhysics;
    torso: { pIdx: number; mesh: THREE.Mesh };
    head: { pIdx: number; mesh: THREE.Mesh };

    moveDir = new THREE.Vector2();
    aimDir = new THREE.Vector2(1, 0);
    mousePos = new THREE.Vector2();
    keys = new Set<string>();

    jumpCooldown = 0;

    constructor(physics: WebPhysics, spawnPos: THREE.Vector2) {
        this.physics = physics;

        // 1. Torso (Kapsuła)
        const tIdx = physics.allocParticle();
        physics.setParticle(tIdx, spawnPos.clone(), 1/5, 0.8);
        // Promień fizyczny znacznie mniejszy niż wizualny (0.2), aby uniknąć kolizji wewnętrznej z głową!
        physics.particles[tIdx*8+7] = 0.2; 
        const tMesh = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.25, 0.4, 4, 16), 
            new THREE.MeshBasicMaterial({ color: 0x88cc33 })
        );
        tMesh.rotation.z = Math.PI / 2;
        physics.scene.add(tMesh);
        this.torso = { pIdx: tIdx, mesh: tMesh };

        // 2. Głowa
        const hIdx = physics.allocParticle();
        const headPos = spawnPos.clone().add(new THREE.Vector2(0.4, 0));
        physics.setParticle(hIdx, headPos, 1/2, 0.5);
        // Promień fizyczny mniejszy (0.15). Suma z tułowiem to 0.35.
        physics.particles[hIdx*8+7] = 0.15;
        const hMesh = new THREE.Mesh(
            new THREE.CircleGeometry(0.2, 32), 
            new THREE.MeshBasicMaterial({ color: 0x88cc33 })
        );
        physics.scene.add(hMesh);
        this.head = { pIdx: hIdx, mesh: hMesh };

        // Sztywne połączenie głowy z tułowiem - dystans = 0.4 (większy niż suma promieni 0.35!)
        const cIdx = physics.allocConstraint();
        physics.setDistConstraint(cIdx, tIdx, hIdx, 0.4, 0, physics.assignColor(tIdx, hIdx));

        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
    }

    onKeyDown = (e: KeyboardEvent) => this.keys.add(e.code);
    onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);

    dispose() {
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        this.physics.scene.remove(this.torso.mesh); 
        this.physics.freeParticle(this.torso.pIdx);
        this.physics.scene.remove(this.head.mesh); 
        this.physics.freeParticle(this.head.pIdx);
    }

    getTorsoPos() {
        return new THREE.Vector2(
            this.physics.particles[this.torso.pIdx * 8], 
            this.physics.particles[this.torso.pIdx * 8 + 1]
        );
    }

    update(mouseWorld: THREE.Vector2) {
        this.mousePos.copy(mouseWorld);
        this.moveDir.set(0, 0);
        
        if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.moveDir.x -= 1;
        if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.moveDir.x += 1;
        
        this.aimDir.copy(this.mousePos).sub(this.getTorsoPos()).normalize();

        this.applyToPhysics();
    }

    private applyToPhysics() {
        const tIdx = this.torso.pIdx;
        const hIdx = this.head.pIdx;
        const tOff = tIdx * 8;
        const hOff = hIdx * 8;

        // Prosty ruch w lewo/prawo
        if (this.moveDir.x !== 0) {
            this.physics.particles[tOff + 2] -= this.moveDir.x * 0.4;
        } else {
            // Sztuczne hamowanie jeśli gracz puścił klawisz
            const vx = this.physics.particles[tOff] - this.physics.particles[tOff + 2];
            this.physics.particles[tOff + 2] += vx * 0.1;
        }
        this.physics.dirtyParticles.add(tIdx);

        // Prosty skok
        if (this.keys.has('Space') && this.jumpCooldown <= 0) {
            this.physics.particles[tOff + 3] -= 1.8; 
            this.physics.dirtyParticles.add(tIdx);
            this.jumpCooldown = 40;
        }
        if (this.jumpCooldown > 0) this.jumpCooldown--;

        // System celowania głową - bezpieczna kierunkowa siła pociągowa (zamiast wybuchowej sprężyny)
        // Sam constraint trzyma dystans na sztywno, więc pociągnięcie po prostu obraca Zyzia!
        this.physics.particles[hOff + 2] -= this.aimDir.x * 0.25;
        this.physics.particles[hOff + 3] -= this.aimDir.y * 0.25;
        this.physics.dirtyParticles.add(hIdx);

        this.physics.syncGPU();
        this.syncMeshes();
    }

    private syncMeshes() {
        const tPos = this.getTorsoPos();
        const hPos = new THREE.Vector2(
            this.physics.particles[this.head.pIdx * 8], 
            this.physics.particles[this.head.pIdx * 8 + 1]
        );

        this.torso.mesh.position.set(tPos.x, tPos.y, 0.2);
        this.head.mesh.position.set(hPos.x, hPos.y, 0.25);
        this.head.mesh.rotation.z = Math.atan2(this.aimDir.y, this.aimDir.x);
    }
}
