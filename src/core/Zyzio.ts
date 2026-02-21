import * as THREE from 'three';
import { world, type Entity } from '../ecs';
import { WebPhysics } from '../webPhysics';

export class Zyzio {
    physics: WebPhysics;
    torsoId: string;
    headId: string;
    constraintId: string;

    moveDir = new THREE.Vector2();
    aimDir = new THREE.Vector2(1, 0);
    mousePos = new THREE.Vector2();
    keys = new Set<string>();

    jumpCooldown = 0;

    constructor(physics: WebPhysics, spawnPos: THREE.Vector2) {
        this.physics = physics;

        const torso = this.createPart('torso', spawnPos, false, 0.35, 5);
        this.torsoId = torso.id;

        const headPos = spawnPos.clone().add(new THREE.Vector2(0.75, 0));
        const head = this.createPart('head', headPos, true, 0.2, 2);
        this.headId = head.id;

        const cId = Math.random().toString(36).substr(2, 9);
        world.add({
            id: cId,
            name: 'zyzio_neck',
            tags: ['constraint'],
            physicsConstraint: {
                targetA: this.torsoId,
                targetB: this.headId,
                length: 0.75,
                stiffness: 0,
                index: undefined as any
            }
        });
        this.constraintId = cId;

        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
    }

    private createPart(name: string, pos: THREE.Vector2, isCircle: boolean, physRadius: number, mass: number): Entity {
        const id = Math.random().toString(36).substr(2, 9);

        const ent: Entity = {
            id, name: `zyzio_${name}_${id}`, tags: ['zyzio', name],
            transform: { position: pos.clone(), rotation: isCircle ? 0 : Math.PI / 2, scale: new THREE.Vector2(1,1) },
            velocity: new THREE.Vector2(),
            force: new THREE.Vector2(),
            physicsBody: { isStatic: false, mass, friction: 0.2, collisionMask: 0xFFFFFFFF, groupId: 1 },
            sdfCollider: { shapeType: 0, parameters: [physRadius, 0, 0, 0, 0] }
        };

        const meshScale = isCircle ? physRadius : 0.25;
        const mesh = new THREE.Mesh(
            isCircle ? new THREE.CircleGeometry(meshScale, 32) : new THREE.CapsuleGeometry(meshScale, 0.4, 4, 16),
            new THREE.MeshBasicMaterial({ color: 0x88cc33 })
        );
        mesh.position.set(pos.x, pos.y, 0.2);
        ent.renderable = { mesh };

        world.add(ent);
        this.physics.scene.add(mesh);
        return ent;
    }

    onKeyDown = (e: KeyboardEvent) => this.keys.add(e.code);
    onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);

    dispose() {
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        
        const ents = [this.torsoId, this.headId, this.constraintId];
        for (const id of ents) {
            const e = world.entities.find(x => x.id === id);
            if (e) {
                if (e.renderable) this.physics.scene.remove(e.renderable.mesh);
                if (e.physicsParticle) this.physics.releaseParticles([e.physicsParticle.index]);
                if (e.physicsConstraint?.index !== undefined) this.physics.releaseConstraints([e.physicsConstraint.index]);
                world.remove(e);
            }
        }
    }

    getTorsoPos(): THREE.Vector2 {
        const torso = world.entities.find(e => e.id === this.torsoId);
        if (torso && torso.transform) return torso.transform.position.clone();
        return new THREE.Vector2();
    }

    update(mouseWorld: THREE.Vector2) {
        this.mousePos.copy(mouseWorld);
        this.moveDir.set(0, 0);
        if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.moveDir.x -= 1;
        if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.moveDir.x += 1;
        
        const torso = world.entities.find(e => e.id === this.torsoId);
        if (torso && torso.transform) {
            this.aimDir.copy(this.mousePos).sub(torso.transform.position).normalize();
            this.applyToPhysics();
        }
    }

    private applyToPhysics() {
        const torso = world.entities.find(e => e.id === this.torsoId);
        const head = world.entities.find(e => e.id === this.headId);

        if (!torso || !torso.transform || !torso.velocity || !head || !head.transform) return;
        if (!torso.force) torso.force = new THREE.Vector2();
        if (!head.force) head.force = new THREE.Vector2();

        const torsoPos = torso.transform.position;
        const headPos = head.transform.position;
        const vx = torso.velocity.x;
        const maxSpeed = 0.12;

        // Poruszanie z limitem prędkości
        if (this.moveDir.x !== 0) {
            if (Math.abs(vx) < maxSpeed || Math.sign(vx) !== Math.sign(this.moveDir.x)) {
                torso.force.x += this.moveDir.x * 0.015;
            }
        } else {
            torso.force.x += -vx * 0.1; // Hamulce
        }

        // Skok
        if (this.keys.has('Space') && this.jumpCooldown <= 0) {
            torso.force.y += 0.18;
            this.jumpCooldown = 40;
        }
        if (this.jumpCooldown > 0) this.jumpCooldown--;

        // Torque aplikowany do karku 
        const currentDir = headPos.clone().sub(torsoPos).normalize();
        // const alignForce = this.aimDir.clone().sub(currentDir).multiplyScalar(0.25);

        // head.force.add(alignForce);
        // torso.force.sub(alignForce);
        
        // Aktualizacja obrotu siatki głowy na podstawie aktualnego celowania
        head.transform.rotation = Math.atan2(this.aimDir.y, this.aimDir.x);
    }
}
