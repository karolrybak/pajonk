import * as THREE from 'three';
// @ts-ignore - WebGPU is built-in to three.js r182+
import WebGPURenderer from 'three/src/renderers/webgpu/WebGPURenderer.js';
import { WebPhysics } from './webPhysics';

// WebGPU global types
declare global {
  interface Navigator {
    gpu?: GPU;
  }
}

let scene: THREE.Scene, camera: THREE.OrthographicCamera, renderer: any, physics: WebPhysics, stateDisplay: HTMLSpanElement;
let activeRope: any = null;
const mouseWorld = new THREE.Vector2();
const BOUNDS = { width: 24, height: 14 };

// WebGPU Detection
async function checkWebGPU(): Promise<boolean> {
    if (!navigator.gpu) {
        const warning = document.getElementById('warning');
        if (warning) warning.classList.add('show');
        console.error('WebGPU nie dostępna w tej przeglądarce');
        return false;
    }
    return true;
}

async function init() {
    // Check WebGPU support
    if (!(await checkWebGPU())) return;

    stateDisplay = document.getElementById('state') as HTMLSpanElement;
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-BOUNDS.width/2, BOUNDS.width/2, BOUNDS.height/2, -BOUNDS.height/2, 0.1, 1000);
    camera.position.z = 10;
    
    renderer = new WebGPURenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // Wait for WebGPU renderer to be ready
    await renderer.init();

    physics = new WebPhysics(renderer, scene, BOUNDS);
    await physics.init();

    const arenaGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(BOUNDS.width, BOUNDS.height, 0));
    scene.add(new THREE.LineSegments(arenaGeo, new THREE.LineBasicMaterial({ color: 0x444444 })));

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('wheel', onWheel);
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
    
    if (activeRope) {
        // Pin to wall or just release
        physics.pinActiveRope(activeRope, pos);
        activeRope = null;
    } else {
        activeRope = physics.createRope(pos);
    }
}

function onMouseMove(e: MouseEvent) {
    mouseWorld.copy(getMouseWorld(e));
}

function onWheel(e: WheelEvent) {
    if (activeRope) {
        const delta = e.deltaY * 0.01;
        physics.adjustRopeLength(activeRope, delta);
    }
}

function animate() {
    requestAnimationFrame(animate);
    if (physics.ready) {
        physics.update(mouseWorld);
    }
    renderer.render(scene, camera);
    
    stateDisplay.innerText = `XPBD WebGPU | Active: ${activeRope ? 'YES (Scroll to reel)' : 'NO (Click to start)'}`;
}

init();
