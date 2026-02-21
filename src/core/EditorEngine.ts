import * as THREE from 'three';
import { AppEngine } from './AppEngine';
import { getMouseWorld } from '../utils';
import { BOUNDS } from '../constants';
import { addObject } from './EntityFactory';
import { world } from '../ecs';

export class EditorEngine extends AppEngine {
    tool = 'select';
    isPaused = false;
    private onKeyDownBound: (e: KeyboardEvent) => void;

    constructor(canvas: HTMLElement) {
        super(canvas);
        this.onKeyDownBound = this.onKeyDown.bind(this);
    }

    async init() {
        await super.init();
        window.addEventListener('keydown', this.onKeyDownBound);
        addObject(this.scene, 'static', 'box', new THREE.Vector2(0, -6));
    }

    dispose() {
        window.removeEventListener('keydown', this.onKeyDownBound);
        super.dispose();
    }

    private createConstraint(type: number, a: string, b: string, c: string | undefined, rest: number) {
        world.add({
            id: Math.random().toString(36).substr(2, 9),
            name: `constraint_${type}`,
            tags: ['constraint'],
            physicsConstraint: {
                type, targetA: a, targetB: b, targetC: c, restValue: rest, stiffness: 0.0001, index: undefined as any
            }
        });
    }

    private onKeyDown(e: KeyboardEvent) {
        const pos = new THREE.Vector2(0, 0);
        
        if (e.key === '1') {
            // Dumbbell (Distance)
            const objA = addObject(this.scene, 'dynamic', 'circle', pos.clone().add(new THREE.Vector2(-1, 2)));
            const objB = addObject(this.scene, 'dynamic', 'circle', pos.clone().add(new THREE.Vector2(1, 2)));
            this.createConstraint(0, objA.id, objB.id, undefined, 2.0);
        } 
        else if (e.key === '2') {
            // Staw / Ramię (Angular + Distance)
            const objA = addObject(this.scene, 'dynamic', 'circle', pos.clone().add(new THREE.Vector2(-1, 2)));
            const objB = addObject(this.scene, 'dynamic', 'circle', pos.clone().add(new THREE.Vector2(0, 2)));
            const objC = addObject(this.scene, 'dynamic', 'circle', pos.clone().add(new THREE.Vector2(0, 3)));
            this.createConstraint(0, objA.id, objB.id, undefined, 1.0);
            this.createConstraint(0, objB.id, objC.id, undefined, 1.0);
            this.createConstraint(1, objA.id, objB.id, objC.id, Math.PI / 2);
        }
        else if (e.key === '3') {
            // Miękki Trójkąt (Area + Distance)
            const objA = addObject(this.scene, 'dynamic', 'circle', pos.clone().add(new THREE.Vector2(-1, 2)));
            const objB = addObject(this.scene, 'dynamic', 'circle', pos.clone().add(new THREE.Vector2(1, 2)));
            const objC = addObject(this.scene, 'dynamic', 'circle', pos.clone().add(new THREE.Vector2(0, 4)));
            this.createConstraint(0, objA.id, objB.id, undefined, 2.0);
            this.createConstraint(0, objB.id, objC.id, undefined, 2.23);
            this.createConstraint(0, objC.id, objA.id, undefined, 2.23);
            this.createConstraint(2, objA.id, objB.id, objC.id, 2.0);
        }
        else if (e.key === '4') {
            // Zderzające się kulki (Inequality Collision)
            const objA = addObject(this.scene, 'dynamic', 'circle', pos.clone().add(new THREE.Vector2(-0.1, 2)));
            const objB = addObject(this.scene, 'dynamic', 'circle', pos.clone().add(new THREE.Vector2(0.1, 2)));
            this.createConstraint(4, objA.id, objB.id, undefined, 1.5);
        }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            // Actuator (Zmiana restValue w locie)
            const dir = e.key === 'ArrowUp' ? 0.1 : -0.1;
            for (const ent of world.with('physicsConstraint')) {
                ent.physicsConstraint.restValue += dir;
            }
        }
    }
}
