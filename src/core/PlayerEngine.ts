import * as THREE from 'three';
import { AppEngine } from './AppEngine';
import { Zyzio } from './Zyzio';
import { getMouseWorld } from '../utils';
import { BOUNDS } from '../constants';
import { addObject } from './EntityFactory';

export class PlayerEngine extends AppEngine {
    playerRig: Zyzio | null = null;
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
        if (this.playerRig) this.playerRig.dispose();
        super.dispose();
    }

    spawnPlayer() {
        // Zespawnujmy twardą podłogę dla pewności
        addObject(this.scene, 'static', 'box', new THREE.Vector2(0, -6));
        this.playerRig = new Zyzio(this.physics, new THREE.Vector2(0, 0));
    }

    onMouseMove(e: MouseEvent) {
        this.mouseWorld.copy(getMouseWorld(e, this.canvas, BOUNDS));
    }

    protected onUpdate() {
        if (this.physics.ready) {
            if (this.playerRig) {
                this.playerRig.update(this.mouseWorld);
            }
        }
    }
}
