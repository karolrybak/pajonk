import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import * as THREE from 'three';
// @ts-ignore
import WebGPURenderer from 'three/src/renderers/webgpu/WebGPURenderer.js';
import { WebPhysics, CONFIG } from './webPhysics';

const BOUNDS = { width: 24, height: 14 };

type ToolMode = 'select' | 'build_line' | 'cut_line' | 'create_obj' | 'edit_obj' | 'joint';

const App = () => {
    const canvasRef = useRef<HTMLDivElement>(null);
    const physicsRef = useRef<WebPhysics | null>(null);
    
    const [tool, setTool] = useState<ToolMode>('select');
    const toolRef = useRef(tool);
    useEffect(() => { toolRef.current = tool; }, [tool]);

    const [isPaused, setIsPaused] = useState(false);
    useEffect(() => {
        if (physicsRef.current) physicsRef.current.paused = isPaused;
    }, [isPaused]);

    const [objShape, setObjShape] = useState<'circle' | 'box' | 'polygon'>('circle');
    const objShapeRef = useRef(objShape);
    useEffect(() => { objShapeRef.current = objShape; }, [objShape]);

    const [objBody, setObjBody] = useState<'dynamic' | 'static' | 'kinematic'>('dynamic');
    const objBodyRef = useRef(objBody);
    useEffect(() => { objBodyRef.current = objBody; }, [objBody]);

    const [objMass, setObjMass] = useState<number>(10.0);
    const objMassRef = useRef(objMass);
    useEffect(() => { objMassRef.current = objMass; }, [objMass]);

    const [lineBuildMode, setLineBuildMode] = useState<'manual' | 'auto'>('manual');
    const lineBuildModeRef = useRef(lineBuildMode);
    useEffect(() => { lineBuildModeRef.current = lineBuildMode; }, [lineBuildMode]);

    const [activeRope, setActiveRope] = useState(false);
    const [fps, setFps] = useState(0);

    useEffect(() => {
        if (!canvasRef.current) return;

        let scene: THREE.Scene, camera: THREE.OrthographicCamera, renderer: any;
        let mouseWorld = new THREE.Vector2();
        let isMouseDown = false;
        let frameCount = 0, lastTime = performance.now();
        let jointStartIdx: number | null = null;
        let jointLine: THREE.Line | null = null;

        const init = async () => {
            scene = new THREE.Scene();
            camera = new THREE.OrthographicCamera(-BOUNDS.width/2, BOUNDS.width/2, BOUNDS.height/2, -BOUNDS.height/2, 0.1, 1000);
            camera.position.z = 10;

            renderer = new WebGPURenderer({ antialias: true });
            renderer.setSize(window.innerWidth, window.innerHeight);
            canvasRef.current?.appendChild(renderer.domElement);

            await renderer.init();
            const physics = new WebPhysics(renderer, scene, BOUNDS);
            await physics.init();
            physicsRef.current = physics;
            physics.paused = isPaused;

            const frameMat = new THREE.LineBasicMaterial({ color: 0x333333 });
            const frameGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(BOUNDS.width - 0.2, BOUNDS.height - 0.2, 0));
            scene.add(new THREE.LineSegments(frameGeo, frameMat));

            // Joint preview line
            const jointMat = new THREE.LineDashedMaterial({ color: 0xffaa00, dashSize: 0.2, gapSize: 0.1 });
            const jointGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
            jointLine = new THREE.Line(jointGeo, jointMat);
            jointLine.computeLineDistances();
            jointLine.visible = false;
            scene.add(jointLine);

            const animate = () => {
                const now = performance.now();
                frameCount++;
                if (now - lastTime >= 1000) {
                    setFps(frameCount); frameCount = 0; lastTime = now;
                }

                if (physics.ready) {
                    if (physics.activeRope && toolRef.current === 'build_line' && lineBuildModeRef.current === 'auto') {
                        const rope = physics.activeRope;
                        const tailIdx = rope.indices[rope.indices.length - 1];
                        physics.setParticlePos(tailIdx, mouseWorld);
                        let prevPos = physics.getParticlePos(rope.indices[rope.indices.length - 2]);
                        while (prevPos.distanceTo(mouseWorld) > CONFIG.SEGMENT_LENGTH * 1.3 && rope.indices.length < 500) {
                            const beforeLen = rope.indices.length;
                            physics.adjustRopeLength(rope, -1);
                            if (rope.indices.length === beforeLen) break; // Buffer limit reached
                            prevPos = physics.getParticlePos(rope.indices[rope.indices.length - 2]);
                        }
                    }
                    
                    physics.update(mouseWorld);
                    setActiveRope(physics.activeRope !== null);
                    
                    if (jointStartIdx !== null && jointLine && jointLine.visible) {
                        const pPos = physics.getParticlePos(jointStartIdx);
                        const positions = jointLine.geometry.attributes.position as THREE.BufferAttribute;
                        positions.setXYZ(0, pPos.x, pPos.y, 0);
                        positions.setXYZ(1, mouseWorld.x, mouseWorld.y, 0);
                        positions.needsUpdate = true;
                        jointLine.computeLineDistances();
                    }
                }
                renderer.render(scene, camera);
                requestAnimationFrame(animate);
            };

            const onMouseMove = (e: MouseEvent) => {
                const x = (e.clientX / window.innerWidth) * 2 - 1;
                const y = -(e.clientY / window.innerHeight) * 2 + 1;
                mouseWorld.set(x * (BOUNDS.width / 2), y * (BOUNDS.height / 2));

                if (isMouseDown && toolRef.current === 'cut_line' && physics.ready) {
                    const cIdx = physics.findIntersectingConstraint(mouseWorld, 0.5);
                    if (cIdx !== -1) {
                        physics.freeConstraint(cIdx);
                        physics.syncGPU();
                        physics.updateVisuals();
                    }
                }
            };

            const onMouseDown = (e: MouseEvent) => {
                if (e.target !== renderer.domElement) return; // Ignore clicks on GUI
                if (e.button === 1) {
                    setLineBuildMode(prev => prev === 'manual' ? 'auto' : 'manual');
                    e.preventDefault();
                    return;
                }
                if (e.button !== 0) return;
                if (!physics.ready) return;
                isMouseDown = true;
                
                const currentTool = toolRef.current;
                
                if (currentTool === 'build_line') {
                    const anchor = physics.findAnchor(mouseWorld);
                    if (physics.activeRope) {
                        if (anchor) physics.pinActiveRope(physics.activeRope, anchor);
                    } else if (anchor) {
                        physics.createRope(anchor);
                    }
                } else if (currentTool === 'create_obj') {
                    const shape = objShapeRef.current;
                    const bodyType = objBodyRef.current;
                    
                    if (shape === 'circle') {
                        physics.spawnBall(mouseWorld.clone(), bodyType, 0.5, objMassRef.current);
                    } else if (shape === 'box') {
                        if (bodyType !== 'dynamic') {
                            physics.addObstacle(mouseWorld.clone(), new THREE.Vector2(1.5, 1.5), 1);
                        }
                    }
                } else if (currentTool === 'edit_obj') {
                    const pIdx = physics.getNearestParticle(mouseWorld, 1.0);
                    if (pIdx !== -1) physics.dragParticleIdx = pIdx;
                } else if (currentTool === 'cut_line') {
                    const cIdx = physics.findIntersectingConstraint(mouseWorld, 0.5);
                    if (cIdx !== -1) {
                        physics.freeConstraint(cIdx);
                        physics.syncGPU();
                        physics.updateVisuals();
                    }
                } else if (currentTool === 'joint') {
                    const pIdx = physics.getNearestParticle(mouseWorld, 1.0);
                    if (pIdx !== -1) {
                        if (jointStartIdx === null) {
                            jointStartIdx = pIdx;
                            if (jointLine) jointLine.visible = true;
                        } else {
                            if (jointStartIdx !== pIdx) {
                                physics.createJoint(jointStartIdx, pIdx);
                            }
                            jointStartIdx = null;
                            if (jointLine) jointLine.visible = false;
                        }
                    } else {
                        jointStartIdx = null;
                        if (jointLine) jointLine.visible = false;
                    }
                }
            };

            const onMouseUp = () => {
                isMouseDown = false;
                if (physics.ready) {
                    physics.dragParticleIdx = -1;
                }
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mousedown', onMouseDown);
            window.addEventListener('mouseup', onMouseUp);
            window.addEventListener('wheel', (e) => {
                if (e.target !== renderer.domElement) return;
                if (physics.activeRope && toolRef.current === 'build_line') {
                    physics.adjustRopeLength(physics.activeRope, e.deltaY);
                }
            });

            animate();
        };

        init();
    }, []);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div ref={canvasRef} />
            
            <div style={{ position: 'absolute', top: 20, left: 20, width: 280, background: 'rgba(20,20,20,0.9)', border: '1px solid #444', padding: 15, borderRadius: 8, pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0 }}>Sandbox Editor</h3>
                    <button onClick={() => setIsPaused(!isPaused)} style={{ background: isPaused ? '#aa3333' : '#33aa33', color: 'white', border: 'none', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold' }}>
                        {isPaused ? '▶ Play' : '⏸ Pause'}
                    </button>
                </div>
                
                <div style={{ fontSize: 12, color: '#aaa' }}>FPS: {fps} | Rope: {activeRope ? 'YES' : 'NO'}</div>
                
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {(['select', 'build_line', 'cut_line', 'create_obj', 'edit_obj', 'joint'] as const).map(t => (
                        <button key={t} onClick={() => setTool(t)} style={{ flex: '1 1 45%', background: tool === t ? '#4a90e2' : '#333', color: 'white', border: 'none', padding: '6px', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: tool === t ? 'bold' : 'normal' }}>
                            {t.replace('_', ' ').toUpperCase()}
                        </button>
                    ))}
                </div>

                {tool === 'build_line' && (
                    <div style={{ background: '#222', padding: 10, borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{ fontSize: 12 }}>Line Mode:</label>
                            <span style={{ fontSize: 12, fontWeight: 'bold', color: lineBuildMode === 'auto' ? '#4a90e2' : '#aaa' }}>
                                {lineBuildMode.toUpperCase()}
                            </span>
                        </div>
                        <span style={{ fontSize: 10, color: '#888' }}>Middle-click canvas to toggle auto-spool.</span>
                    </div>
                )}

                {tool === 'create_obj' && (
                    <div style={{ background: '#222', padding: 10, borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{ fontSize: 12 }}>Body Type:</label>
                            <select value={objBody} onChange={e => setObjBody(e.target.value as any)} style={{ background: '#111', color: 'white', border: '1px solid #444', padding: 4, width: '120px' }}>
                                <option value="dynamic">Dynamic</option>
                                <option value="static">Static</option>
                                <option value="kinematic">Kinematic</option>
                            </select>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{ fontSize: 12 }}>Shape:</label>
                            <select value={objShape} onChange={e => setObjShape(e.target.value as any)} style={{ background: '#111', color: 'white', border: '1px solid #444', padding: 4, width: '120px' }}>
                                <option value="circle">Circle</option>
                                <option value="box">Box (Static Only)</option>
                                <option value="polygon">Polygon (TBD)</option>
                            </select>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{ fontSize: 12 }}>Mass:</label>
                            <input type="number" value={objMass} onChange={e => setObjMass(Number(e.target.value))} style={{ background: '#111', color: 'white', border: '1px solid #444', padding: 4, width: '110px' }} disabled={objBody !== 'dynamic'} min="0.1" step="0.5" />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
