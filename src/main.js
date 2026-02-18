import * as THREE from 'three';
import { WebPhysics } from './webPhysics.js';

let scene, camera, renderer, physics, stateDisplay;
let activeRope = null;
const mouseWorld = new THREE.Vector2();
const BOUNDS = { width: 24, height: 14 };

function init() {
    stateDisplay = document.getElementById('state');
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-BOUNDS.width/2, BOUNDS.width/2, BOUNDS.height/2, -BOUNDS.height/2, 0.1, 1000);
    camera.position.z = 10;
    
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    physics = new WebPhysics(scene, BOUNDS);

    // Arena visual
    const arenaGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(BOUNDS.width, BOUNDS.height, 0));
    scene.add(new THREE.LineSegments(arenaGeo, new THREE.LineBasicMaterial({ color: 0x444444 })));

    // Visualize SDF obstacles
    const obstacleMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    
    // Circle 1
    const c1 = new THREE.Mesh(new THREE.CircleGeometry(1.5, 32), obstacleMat);
    c1.position.set(4, 2, -1);
    scene.add(c1);

    // Circle 2
    const c2 = new THREE.Mesh(new THREE.CircleGeometry(1.2, 32), obstacleMat);
    c2.position.set(-5, -1, -1);
    scene.add(c2);

    // Box 1
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 0.1), obstacleMat);
    b1.position.set(0, -4, -1);
    scene.add(b1);

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('wheel', onWheel);
    window.addEventListener('resize', () => renderer.setSize(window.innerWidth, window.innerHeight));

    animate();
}

function getMouseWorld(e) {
    const x = (e.clientX / window.innerWidth) * 2 - 1;
    const y = -(e.clientY / window.innerHeight) * 2 + 1;
    return new THREE.Vector2(x * (BOUNDS.width / 2), y * (BOUNDS.height / 2));
}

function onMouseDown(e) {
    const pos = getMouseWorld(e);
    const anchor = physics.findAnchor(pos);
    
    if (activeRope) {
        if (anchor) {
            const lastPoint = activeRope.points[activeRope.points.length - 1];
            lastPoint.fixed = anchor.fixed;
            lastPoint.attachment = anchor.attachment;
            lastPoint.pos.copy(anchor.pos);
            activeRope.isBeingBuilt = false;
            activeRope = null;
        }
    } else {
        if (anchor) {
            activeRope = physics.createWeb(anchor.pos, anchor.fixed, anchor.attachment);
        }
    }
}

function onMouseMove(e) {
    mouseWorld.copy(getMouseWorld(e));
}

function onWheel(e) {
    if (activeRope) {
        // Increased sensitivity and corrected direction for intuitive 'reeling'
        const delta = e.deltaY * 0.01;
        activeRope.length = Math.max(0.1, activeRope.length + delta);
    }
}

function animate() {
    requestAnimationFrame(animate);
    const dt = 0.016;
    physics.update(dt, mouseWorld, activeRope);
    renderer.render(scene, camera);
    
    stateDisplay.innerText = `Click on wall/web to start/end silk | Scroll to reel | Active: ${activeRope ? 'YES' : 'NO'}`;
}

init();