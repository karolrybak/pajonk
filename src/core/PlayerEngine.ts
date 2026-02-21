import * as THREE from 'three';
import { AppEngine } from './AppEngine';
import { Zyzio } from './Zyzio';
import { world } from '../ecs';
import { getMouseWorld } from '../utils';
import { BOUNDS } from '../constants';

export class PlayerEngine extends AppEngine {
    playerRig: Zyzio | null = null;
    mouseWorld = new THREE.Vector2();

    constructor(canvas: HTMLElement) {
        super(canvas);
        this.onMouseMove = this.onMouseMove.bind(this);
    }

    override async init() {
        await super.init();
        window.addEventListener('mousemove', this.onMouseMove);
    }

    override dispose() {
        window.removeEventListener('mousemove', this.onMouseMove);
        if (this.playerRig) this.playerRig.dispose();
        super.dispose();
    }

    spawnPlayer() {
        const spawn = world.entities.find(e => e.special?.type === 'player_spawn');
        const pos = spawn ? spawn.position.clone() : new THREE.Vector2(0, 0);
        
        this.playerRig = new Zyzio(this.physics, pos);

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

    protected override onUpdate() {
        if (this.physics.ready) {
            this.physics.paused = false;
            if (this.playerRig) {
                this.playerRig.update(this.mouseWorld);
                
                // Simple camera follow
                // const tPos = this.playerRig.getTorsoPos();
                // this.camera.position.x += (tPos.x - this.camera.position.x) * 0.1;
                // this.camera.position.y += (tPos.y - this.camera.position.y) * 0.1;
            }
            this.physics.update(this.mouseWorld);
        }
    }
}