import * as THREE from 'three';
import { AppEngine } from './AppEngine';
import { getMouseWorld } from '../utils';
import { BOUNDS } from '../constants';
import { addObject } from './EntityFactory';

export class EditorEngine extends AppEngine {
    tool = 'select';
    isPaused = false;
    selectedEntityId: string | null = null;
    private onMouseDownBound: (e: MouseEvent) => void;

    constructor(canvas: HTMLElement) {
        super(canvas);
        this.onMouseDownBound = this.onMouseDown.bind(this);
    }

    async init() {
        await super.init();
        window.addEventListener('mousedown', this.onMouseDownBound);
        // Spawn a floor to prevent items falling infinitely
        addObject(this.scene, 'static', 'box', new THREE.Vector2(0, -6));
    }

    dispose() {
        window.removeEventListener('mousedown', this.onMouseDownBound);
        super.dispose();
    }

    private onMouseDown(e: MouseEvent) {
        if (e.target !== this.renderer.domElement) return;
        const pos = getMouseWorld(e, this.canvas, BOUNDS);
        addObject(this.scene, 'dynamic', 'circle', pos);
    }

    setPlacement(p: any) {}
}
