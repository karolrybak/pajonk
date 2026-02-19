import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import * as THREE from 'three';
// @ts-ignore
import WebGPURenderer from 'three/src/renderers/webgpu/WebGPURenderer.js';
import { WebPhysics, CONFIG } from './webPhysics';
import { world, type Entity } from './ecs';
import { getMouseWorld } from './utils';

const BOUNDS = { width: 24, height: 14 };

type ToolMode = 'select' | 'build_line' | 'create_obj' | 'cut_line' | 'edit_obj' | 'joint';
type PlacementState = { type: 'static' | 'dynamic', shape: 'circle' | 'box' } | null;

const App = () => {
    const canvasRef = useRef<HTMLDivElement>(null);
    const physicsRef = useRef<WebPhysics | null>(null);
    
    const [tool, setTool] = useState<ToolMode>('select');
    const [lineBuildMode, setLineBuildMode] = useState<'manual' | 'auto'>('manual');
    const [isPaused, setIsPaused] = useState(true);
    const [showPanels, setShowPanels] = useState({ list: true, props: true });
    const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
    const [isLevelMenuOpen, setIsLevelMenuOpen] = useState(false);
    const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
    const [placement, setPlacement] = useState<PlacementState>(null);
    const [fps, setFps] = useState(0);

    const toolRef = useRef(tool);
    const lineBuildModeRef = useRef(lineBuildMode);
    const isPausedRef = useRef(isPaused);
    const placementRef = useRef(placement);
    const ghostMeshRef = useRef<THREE.Mesh | null>(null);

    useEffect(() => { 
        toolRef.current = tool; 
        if (tool !== 'create_obj') setPlacement(null); 
    }, [tool]);
    
    useEffect(() => { lineBuildModeRef.current = lineBuildMode; }, [lineBuildMode]);
    useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
    
    useEffect(() => {
        placementRef.current = placement;
        if (ghostMeshRef.current && physicsRef.current) {
            physicsRef.current.scene.remove(ghostMeshRef.current);
            ghostMeshRef.current = null;
        }
        if (placement && physicsRef.current) {
            const geo = placement.shape === 'circle' ? new THREE.CircleGeometry(0.5, 32) : new THREE.BoxGeometry(1, 1, 0.1);
            const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(0, 0, 0.1);
            physicsRef.current.scene.add(mesh);
            ghostMeshRef.current = mesh;
        }
    }, [placement]);

    const checkPlacementCollision = (pos: THREE.Vector2, shape: 'circle' | 'box') => {
        const radius = 0.5;
        const size = new THREE.Vector2(1, 1);
        for (const ent of world.entities) {
            if (!ent.sdfCollider && !ent.physics) continue;
            const entPos = ent.position;
            const entRadius = ent.physics?.radius || (ent.sdfCollider?.type === 'circle' ? ent.sdfCollider.size.x : 0.7);
            const dist = pos.distanceTo(entPos);
            if (shape === 'circle') {
                if (dist < radius + entRadius) return true;
            } else {
                if (Math.abs(pos.x - entPos.x) < (size.x + (ent.sdfCollider?.size.x || 1)) / 2 && 
                    Math.abs(pos.y - entPos.y) < (size.y + (ent.sdfCollider?.size.y || 1)) / 2) return true;
            }
        }
        return false;
    };

    useEffect(() => {
        if (!canvasRef.current) return;
        let scene: THREE.Scene, camera: THREE.OrthographicCamera, renderer: any;
        let mouseWorld = new THREE.Vector2();
        let frameCount = 0, lastTime = performance.now();

        const init = async () => {
            scene = new THREE.Scene();
            camera = new THREE.OrthographicCamera(-BOUNDS.width/2, BOUNDS.width/2, BOUNDS.height/2, -BOUNDS.height/2, 0.1, 1000);
            camera.position.z = 10;
            renderer = new WebGPURenderer({ antialias: true });
            renderer.setSize(canvasRef.current!.clientWidth, canvasRef.current!.clientHeight);
            canvasRef.current?.appendChild(renderer.domElement);
            await renderer.init();
            const physics = new WebPhysics(renderer, scene, BOUNDS);
            await physics.init();
            physicsRef.current = physics;

            const resizeObserver = new ResizeObserver(() => {
                if (!canvasRef.current) return;
                const w = canvasRef.current.clientWidth;
                const h = canvasRef.current.clientHeight;
                renderer.setSize(w, h);
                camera.updateProjectionMatrix();
            });
            resizeObserver.observe(canvasRef.current);

            const animate = () => {
                const now = performance.now();
                frameCount++;
                if (now - lastTime >= 1000) {
                    setFps(frameCount); frameCount = 0; lastTime = now;
                }
                if (physics.ready) {
                    physics.paused = isPausedRef.current;
                    if (ghostMeshRef.current && placementRef.current) {
                        ghostMeshRef.current.position.set(mouseWorld.x, mouseWorld.y, 0.1);
                        const collided = checkPlacementCollision(mouseWorld, placementRef.current.shape);
                        (ghostMeshRef.current.material as THREE.MeshBasicMaterial).color.set(collided ? 0xff0000 : 0x00ff00);
                    }
                    if (physics.activeRope && toolRef.current === 'build_line' && lineBuildModeRef.current === 'auto') {
                        const rope = physics.activeRope;
                        const tailIdx = rope.indices[rope.indices.length - 1];
                        physics.setParticlePos(tailIdx, mouseWorld);
                        let prevPos = physics.getParticlePos(rope.indices[rope.indices.length - 2]);
                        while (prevPos.distanceTo(mouseWorld) > CONFIG.SEGMENT_LENGTH * 1.3 && rope.indices.length < 500) {
                            physics.adjustRopeLength(rope, -1);
                            prevPos = physics.getParticlePos(rope.indices[rope.indices.length - 2]);
                        }
                    }
                    physics.syncObstacles();
                    physics.update(mouseWorld);
                }
                renderer.render(scene, camera);
                requestAnimationFrame(animate);
            };

            const onMouseMove = (e: MouseEvent) => {
                if (!canvasRef.current) return;
                mouseWorld = getMouseWorld(e, canvasRef.current, BOUNDS);
            };

            const onMouseDown = (e: MouseEvent) => {
                if (!canvasRef.current || e.target !== renderer.domElement) return;
                const mWorld = getMouseWorld(e, canvasRef.current, BOUNDS);
                if (e.button === 1) {
                    setLineBuildMode(prev => prev === 'manual' ? 'auto' : 'manual');
                    return;
                }
                if (!physics.ready) return;

                if (placementRef.current && e.button === 0) {
                    if (!checkPlacementCollision(mWorld, placementRef.current.shape)) {
                        addObject(placementRef.current.type, placementRef.current.shape, { position: mWorld.clone() });
                    }
                    return;
                }

                if (toolRef.current === 'build_line') {
                    const anchor = physics.findAnchor(mWorld);
                    if (physics.activeRope) {
                        if (anchor) physics.pinActiveRope(physics.activeRope, anchor);
                    } else if (anchor) physics.createRope(anchor);
                } else if (toolRef.current === 'select') {
                   const pIdx = physics.getNearestParticle(mWorld, 0.5);
                   const ent = [...world.entities].find(e => e.physics?.particleIdx === pIdx);
                   if (ent) setSelectedEntity(ent);
                   else {
                       const statEnt = [...world.entities].find(e => e.sdfCollider && e.position.distanceTo(mWorld) < 1.5);
                       setSelectedEntity(statEnt || null);
                   }
                }
            };

            const onWheel = (e: WheelEvent) => {
                if (!canvasRef.current || e.target !== renderer.domElement) return;
                if (physics.activeRope && toolRef.current === 'build_line' && lineBuildModeRef.current === 'manual') {
                    physics.adjustRopeLength(physics.activeRope, e.deltaY);
                }
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mousedown', onMouseDown);
            window.addEventListener('contextmenu', (e) => e.preventDefault());
            window.addEventListener('wheel', onWheel);
            animate();
        };
        init();
    }, []);

    const addObject = (type: 'static' | 'dynamic', shape: 'circle' | 'box', data?: Partial<Entity>) => {
        if (!physicsRef.current) return;
        const id = data?.id || Math.random().toString(36).substr(2, 9);
        const name = data?.name || `${type}_${shape}_${id}`;
        const pos = data?.position || new THREE.Vector2(0, 0);
        let pIdx: number | undefined;
        if (type === 'dynamic') pIdx = physicsRef.current.spawnBall(pos, 'dynamic', data?.physics?.radius || 0.5, data?.physics?.mass || 10.0);
        const mat = new THREE.MeshBasicMaterial({ color: type === 'static' ? 0x444444 : 0x00ff88 });
        const geo = shape === 'circle' ? new THREE.CircleGeometry(data?.physics?.radius || 0.5, 32) : new THREE.BoxGeometry(1, 1, 0.1);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(pos.x, pos.y, -0.1);
        mesh.rotation.z = data?.rotation || 0;
        mesh.scale.set(data?.scale?.x || 1, data?.scale?.y || 1, 1);
        physicsRef.current.scene.add(mesh);
        const ent: Entity = {
            id, name, position: pos.clone(), rotation: data?.rotation || 0, scale: data?.scale ? data.scale.clone() : new THREE.Vector2(1, 1),
            sdfCollider: type === 'static' ? { type: shape, size: data?.sdfCollider?.size ? data.sdfCollider.size.clone() : new THREE.Vector2(1, 1) } : undefined,
            physics: type === 'dynamic' ? { bodyType: 'dynamic', mass: data?.physics?.mass || 10, invMass: 1/(data?.physics?.mass || 10), radius: data?.physics?.radius || 0.5, particleIdx: pIdx } : undefined,
            renderable: { mesh }, attachable: data?.attachable !== undefined ? data.attachable : true, tags: data?.tags || [type]
        };
        world.add(ent); setSelectedEntity(ent); return ent;
    };

    const deleteEntity = (ent: Entity) => {
        if (!physicsRef.current) return;
        if (ent.renderable) physicsRef.current.scene.remove(ent.renderable.mesh);
        if (ent.physics?.particleIdx !== undefined) physicsRef.current.freeParticle(ent.physics.particleIdx);
        world.remove(ent); if (selectedEntity?.id === ent.id) setSelectedEntity(null);
    };

    return (
        <div style={{ position: 'fixed', inset: 0, color: '#eee', fontFamily: 'monospace', display: 'flex', flexDirection: 'column', userSelect: 'none', background: '#222' }}>
            <div style={{ height: 40, background: '#111', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', padding: '0 15px', gap: 20, zIndex: 10 }}>
                <div style={{ fontWeight: 'bold', color: '#4a90e2' }}>PAJONK V0.9.9</div>
                <div style={{ display: 'flex', gap: 10 }}>
                   <div style={{ position: 'relative' }}>
                       <button onClick={() => setIsLevelMenuOpen(!isLevelMenuOpen)} style={{ background: '#222', color: '#ccc', border: '1px solid #444', padding: '2px 10px', cursor: 'pointer' }}>Level ▾</button>
                       {isLevelMenuOpen && (
                           <div style={{ position: 'absolute', top: '100%', left: 0, background: '#222', border: '1px solid #444', zIndex: 100, display: 'flex', flexDirection: 'column', minWidth: 100 }}>
                               <button onClick={() => { [...world.entities].forEach(deleteEntity); setIsLevelMenuOpen(false); }} style={{ padding: '8px 15px', border: 'none', background: 'none', color: '#fff', textAlign: 'left', cursor: 'pointer' }}>New</button>
                               <button onClick={() => { setIsLevelMenuOpen(false); }} style={{ padding: '8px 15px', border: 'none', background: 'none', color: '#fff', textAlign: 'left', cursor: 'pointer' }}>Save</button>
                               <button onClick={() => { setIsLevelMenuOpen(false); }} style={{ padding: '8px 15px', border: 'none', background: 'none', color: '#fff', textAlign: 'left', cursor: 'pointer' }}>Load</button>
                           </div>
                       )}
                   </div>
                   <button onClick={() => setIsPaused(!isPaused)} style={{ background: isPaused ? '#33aa33' : '#aa3333', border: 'none', borderRadius: 3, padding: '2px 12px', fontWeight: 'bold', cursor: 'pointer', color: 'white' }}>{isPaused ? '▶ PLAY' : '■ STOP'}</button>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 15, fontSize: 11 }}>
                    <label style={{ cursor: 'pointer' }}><input type="checkbox" checked={showPanels.list} onChange={() => setShowPanels(p => ({...p, list: !p.list}))}/> List</label>
                    <label style={{ cursor: 'pointer' }}><input type="checkbox" checked={showPanels.props} onChange={() => setShowPanels(p => ({...p, props: !p.props}))}/> Props</label>
                </div>
            </div>

            <div style={{ flex: 1, position: 'relative', display: 'flex', overflow: 'hidden' }}>
                {showPanels.list && (
                    <div style={{ width: 220, flexShrink: 0, background: '#111', borderRight: '1px solid #333', padding: 10, overflowY: 'auto' }}>
                        <div style={{ fontSize: 10, marginBottom: 10, color: '#555', letterSpacing: '1px' }}>SCENE HIERARCHY</div>
                        {world.entities.map(e => (
                            <div key={e.id} onClick={() => setSelectedEntity(e)} style={{ padding: '6px 8px', fontSize: 11, borderLeft: selectedEntity?.id === e.id ? '2px solid #4a90e2' : '2px solid transparent', background: selectedEntity?.id === e.id ? '#1a1a1a' : 'transparent', cursor: 'pointer', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: selectedEntity?.id === e.id ? '#fff' : '#aaa' }}>
                                {e.name}
                            </div>
                        ))}
                    </div>
                )}

                <div ref={canvasRef} style={{ flex: 1, position: 'relative', background: '#000', overflow: 'hidden' }}>
                   <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 2, background: '#111', padding: 3, borderRadius: 4, border: '1px solid #444', zIndex: 20 }}>
                        <button onClick={() => setTool('select')} style={{ background: tool === 'select' ? '#4a90e2' : '#222', color: '#fff', border: 'none', padding: '6px 14px', fontSize: 11, cursor: 'pointer' }}>SELECT</button>
                        <button onClick={() => setTool('build_line')} style={{ background: tool === 'build_line' ? '#4a90e2' : '#222', color: '#fff', border: 'none', padding: '6px 14px', fontSize: 11, cursor: 'pointer' }}>ROPE</button>
                        <div style={{ position: 'relative' }}>
                            <button onClick={() => { setTool('create_obj'); setIsCreateMenuOpen(!isCreateMenuOpen); }} style={{ background: tool === 'create_obj' ? '#4a90e2' : '#222', color: '#fff', border: 'none', padding: '6px 14px', fontSize: 11, cursor: 'pointer' }}>CREATE OBJ ▾</button>
                            {isCreateMenuOpen && tool === 'create_obj' && (
                                <div style={{ position: 'absolute', bottom: '100%', left: 0, background: '#111', border: '1px solid #444', display: 'flex', flexDirection: 'column', width: 120, marginBottom: 5 }}>
                                    <button onClick={() => { setPlacement({type: 'static', shape: 'box'}); setIsCreateMenuOpen(false); }} style={{ padding: '8px', background: 'none', border: 'none', color: '#ccc', fontSize: 10, textAlign: 'left', cursor: 'pointer' }}>Static Box</button>
                                    <button onClick={() => { setPlacement({type: 'static', shape: 'circle'}); setIsCreateMenuOpen(false); }} style={{ padding: '8px', background: 'none', border: 'none', color: '#ccc', fontSize: 10, textAlign: 'left', cursor: 'pointer' }}>Static Circ</button>
                                    <button onClick={() => { setPlacement({type: 'dynamic', shape: 'circle'}); setIsCreateMenuOpen(false); }} style={{ padding: '8px', background: 'none', border: 'none', color: '#ccc', fontSize: 10, textAlign: 'left', cursor: 'pointer' }}>Dynamic Ball</button>
                                </div>
                            )}
                        </div>
                        <button onClick={() => setTool('cut_line')} style={{ background: tool === 'cut_line' ? '#4a90e2' : '#222', color: '#fff', border: 'none', padding: '6px 14px', fontSize: 11, cursor: 'pointer' }}>CUT</button>
                   </div>
                   <div style={{ position: 'absolute', top: 10, left: 10, color: '#444', fontSize: 10 }}>FPS: {fps} | Mode: {lineBuildMode.toUpperCase()}</div>
                </div>

                {showPanels.props && selectedEntity && (
                    <div style={{ width: 260, flexShrink: 0, background: '#111', borderLeft: '1px solid #333', padding: 12, overflowY: 'auto' }}>
                        <div style={{ fontSize: 10, marginBottom: 15, color: '#555', letterSpacing: '1px' }}>PROPERTIES</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span>Name</span>
                                <input value={selectedEntity.name} onChange={e => { selectedEntity.name = e.target.value; setSelectedEntity({...selectedEntity}); }} style={{ width: 130, background: '#000', color: '#fff', border: '1px solid #333', padding: '4px 6px' }}/>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span>Position</span>
                                <div style={{ display: 'flex', gap: 4 }}>
                                    <input type="number" value={selectedEntity.position.x} onChange={e => { selectedEntity.position.x = Number(e.target.value); if (selectedEntity.renderable) selectedEntity.renderable.mesh.position.x = selectedEntity.position.x; setSelectedEntity({...selectedEntity}); }} step="0.1" style={{ width: 60, background: '#000', color: '#fff', border: '1px solid #333' }}/>
                                    <input type="number" value={selectedEntity.position.y} onChange={e => { selectedEntity.position.y = Number(e.target.value); if (selectedEntity.renderable) selectedEntity.renderable.mesh.position.y = selectedEntity.position.y; setSelectedEntity({...selectedEntity}); }} step="0.1" style={{ width: 60, background: '#000', color: '#fff', border: '1px solid #333' }}/>
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span>Rotation</span>
                                <input type="number" value={Math.round(THREE.MathUtils.radToDeg(selectedEntity.rotation))} onChange={e => { selectedEntity.rotation = THREE.MathUtils.degToRad(Number(e.target.value)); if (selectedEntity.renderable) selectedEntity.renderable.mesh.rotation.z = selectedEntity.rotation; setSelectedEntity({...selectedEntity}); }} step="5" style={{ width: 124, background: '#000', color: '#fff', border: '1px solid #333' }}/>
                            </div>
                            <button onClick={() => deleteEntity(selectedEntity)} style={{ marginTop: 20, background: '#aa3333', color: '#fff', border: 'none', padding: '10px', cursor: 'pointer', fontWeight: 'bold' }}>DELETE OBJECT</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);