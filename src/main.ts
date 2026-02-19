import * as THREE from 'three';
// @ts-ignore
import WebGPURenderer from 'three/src/renderers/webgpu/WebGPURenderer.js';
import { WebPhysics } from './webPhysics';

let scene: THREE.Scene, camera: THREE.OrthographicCamera, renderer: any, physics: WebPhysics, stateDisplay: HTMLSpanElement;
let activeRope: any = null;
const mouseWorld = new THREE.Vector2();
const BOUNDS = { width: 24, height: 14 };

async function init() {
    if (!navigator.gpu) return;

    stateDisplay = document.getElementById('state') as HTMLSpanElement;
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-BOUNDS.width/2, BOUNDS.width/2, BOUNDS.height/2, -BOUNDS.height/2, 0.1, 1000);
    camera.position.z = 10;
    
    renderer = new WebGPURenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    await renderer.init();

    physics = new WebPhysics(renderer, scene, BOUNDS);
    await physics.init();

    // Visual Frame
    const frameMat = new THREE.LineBasicMaterial({ color: 0x888888, linewidth: 2 });
    const frameGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(BOUNDS.width - 0.2, BOUNDS.height - 0.2, 0));
    scene.add(new THREE.LineSegments(frameGeo, frameMat));

    // Obstacle visual
    const circle = new THREE.Mesh(new THREE.CircleGeometry(1.5, 32), new THREE.MeshBasicMaterial({ color: 0x333333 }));
    circle.position.set(4, 2, -1);
    scene.add(circle);

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('wheel', onWheel);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', () => renderer.setSize(window.innerWidth, window.innerHeight));

    animate();
}

function getMouseWorld(e: MouseEvent): THREE.Vector2 {
    const x = (e.clientX / window.innerWidth) * 2 - 1;
    const y = -(e.clientY / window.innerHeight) * 2 + 1;
    return new THREE.Vector2(x * (BOUNDS.width / 2), y * (BOUNDS.height / 2));
}

function onMouseDown(e: MouseEvent) {
    if (!physics.ready) return;
    const pos = getMouseWorld(e);
    const anchor = physics.findAnchor(pos);
    
    if (activeRope) {
        if (anchor) {
            physics.pinActiveRope(activeRope, anchor);
            activeRope = null;
        }
    } else {
        if (anchor) {
            activeRope = physics.createRope(anchor);
        }
    }
}

function onMouseMove(e: MouseEvent) {
    mouseWorld.copy(getMouseWorld(e));
}

function onWheel(e: WheelEvent) {
    if (activeRope) {
        // Standardizing wheel delta
        const delta = e.deltaY / 100;
        physics.adjustRopeLength(activeRope, delta);
    }
}

function onKeyDown(e: KeyboardEvent) {
    if (e.code === 'KeyQ') {
        physics.spawnBall(mouseWorld);
    }
}

function animate() {
    requestAnimationFrame(animate);
    if (physics.ready) {
        physics.update(mouseWorld);
    }
    renderer.render(scene, camera);
    
    const anchor = physics.findAnchor(mouseWorld);
    const canAnchor = anchor !== null;

    if (activeRope) {
        const color = canAnchor ? 0x00ff00 : 0xff0000;
        activeRope.mesh.material.color.set(color);
        activeRope.pointsMesh.material.color.set(color);
    }

    stateDisplay.innerText = `XPBD | Active: ${activeRope ? 'YES' : 'NO'} | Valid Anchor: ${canAnchor ? 'YES' : 'NO'} | Q: Spawn Ball`;
}

init();