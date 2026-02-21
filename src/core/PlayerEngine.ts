import { AppEngine } from './AppEngine';
import { Zyzio } from './Zyzio';
import { getMouseWorld } from '../utils';
import { BOUNDS } from '../constants';

export class PlayerEngine extends AppEngine {
    playerRig: Zyzio | null = null;
    mouseWorld = new Float32Array([0, 0]);

    constructor(container: HTMLElement) {
        super(container);
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
        this.playerRig = new Zyzio(this.physics, new Float32Array([0, 0]));
    }

    onMouseMove(e: MouseEvent) {
        const pos = getMouseWorld(e, this.canvas, BOUNDS);
        this.mouseWorld.set(pos);
    }

    protected override onUpdate() {
        if (this.physics.ready) {
            if (this.playerRig) {
                this.playerRig.update(this.mouseWorld);
            }
        }
    }
}