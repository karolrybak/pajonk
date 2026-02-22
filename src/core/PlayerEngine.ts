import { AppEngine } from './AppEngine';
import { Zyzio } from './Zyzio';
import { BOUNDS } from '../constants';
import { world } from '../ecs';
import { addObject } from './EntityFactory';

export class PlayerEngine extends AppEngine {
    playerRig: Zyzio | null = null;
    
    keys = { w: false, a: false, s: false, d: false, space: false };

    constructor(container: HTMLElement) {
        super(container);
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);
    }

    override async init() {
        await super.init();
        
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
        
        // Provide a basic floor if the world is completely empty
        if (world.entities.length === 0) {
            addObject(this.physics, 'static', 'box', new Float32Array([0, -6]), BOUNDS.width, 1);
        }

        this.spawnPlayer();
    }

    override dispose() {
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        if (this.playerRig) this.playerRig.dispose();
        super.dispose();
    }

    onKeyDown(e: KeyboardEvent) {
        const key = e.key.toLowerCase();
        if (key === 'w') this.keys.w = true;
        if (key === 'a') this.keys.a = true;
        if (key === 's') this.keys.s = true;
        if (key === 'd') this.keys.d = true;
        if (e.key === ' ') this.keys.space = true;
    }

    onKeyUp(e: KeyboardEvent) {
        const key = e.key.toLowerCase();
        if (key === 'w') this.keys.w = false;
        if (key === 'a') this.keys.a = false;
        if (key === 's') this.keys.s = false;
        if (key === 'd') this.keys.d = false;
        if (e.key === ' ') this.keys.space = false;
    }

    spawnPlayer() {
        this.playerRig = new Zyzio(this.physics, new Float32Array([0, 0]));
        this.isPaused = false; 
    }

    protected override onUpdate() {
        if (this.physics.ready && this.playerRig) {
            this.playerRig.update(this.keys);
        }
    }
}
