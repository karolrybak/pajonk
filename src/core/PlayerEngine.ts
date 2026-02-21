import * as THREE from 'three';
import { AppEngine } from './AppEngine';
import { PlayerController } from './PlayerController';
import { world } from '../ecs';
import { addObject } from './EntityFactory';
import { getMouseWorld } from '../utils';
import { BOUNDS } from '../constants';

export class PlayerEngine extends AppEngine {
    playerController: PlayerController | null = null;
    mouseWorld = new THREE.Vector2();

    constructor(canvas: HTMLElement) {
        super(canvas);
        this.onMouseMove = this.onMouseMove.bind(this);
    }

    async init() {
        await super.init();
        window.addEventListener('mousemove', this.onMouseMove);
    }

    dispose() {
        window.removeEventListener('mousemove', this.onMouseMove);
        super.dispose();
    }

    spawnPlayer() {
        const spawn = world.entities.find(e => e.special?.type === 'player_spawn');
        const pos = spawn ? spawn.position.clone() : new THREE.Vector2(0, 0);
        
        // 1. Torso (Center)
        const torso = addObject(this.physics, 'dynamic', 'circle', {
            name: 'Pajonk Torso',
            position: pos.clone(),
            physics: { bodyType: 'dynamic', mass: 10, invMass: 1/10, radius: 0.4 },
            playerPart: { role: 'torso' }
        });

        // 2. Head (Front)
        const head = addObject(this.physics, 'dynamic', 'circle', {
            name: 'Pajonk Head',
            position: pos.clone().add(new THREE.Vector2(0.4, 0)),
            physics: { bodyType: 'dynamic', mass: 4, invMass: 1/4, radius: 0.25 },
            playerPart: { role: 'head' }
        });

        if (torso && head) {
            const pT = torso.physics!.particleIdx!;
            const pH = head.physics!.particleIdx!;

            // Distance Constraint
            const distTH = 0.45;
            const cIdx = this.physics.allocConstraint();
            this.physics.setDistConstraint(cIdx, pT, pH, distTH, 0, this.physics.assignColor(pT, pH));

            // Visual Polish
            if (torso.renderable) {
                (torso.renderable.mesh.material as THREE.MeshBasicMaterial).color.setHex(0xaa00ff);
                torso.renderable.mesh.position.z = 0.5;
            }
            if (head.renderable) {
                (head.renderable.mesh.material as THREE.MeshBasicMaterial).color.setHex(0xdd66ff);
                head.renderable.mesh.position.z = 0.6;
            }

            this.playerController = new PlayerController([torso, head], this.physics);
        }

        // Hide markers
        for (const ent of world.entities) {
            if (ent.special && ent.renderable) {
                ent.renderable.mesh.visible = false;
            }
        }
    }

    onMouseMove(e: MouseEvent) {
        this.mouseWorld.copy(getMouseWorld(e, this.canvas, BOUNDS));
    }

    protected onUpdate() {
        if (this.physics.ready) {
            this.physics.paused = false;
            this.physics.update(this.mouseWorld);
            if (this.playerController) {
                this.playerController.update(this.mouseWorld);
            }
        }
    }
}