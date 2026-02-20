import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import * as THREE from 'three';
import { world, type Entity } from './ecs';
import { EditorEngine } from './core/EditorEngine';
import { deleteEntity, updatePhysicsFromUI } from './core/EntityFactory';
import type { ToolMode, PlacementState } from './types';

const App = () => {
    const canvasRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<EditorEngine | null>(null);

    const [tool, setTool] = useState<ToolMode>('select');
    const [lineBuildMode, setLineBuildMode] = useState<'manual' | 'auto'>('manual');
    const [isPaused, setIsPaused] = useState(true);
    const [showPanels, setShowPanels] = useState({ list: true, props: true });
    const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
    const [isLevelMenuOpen, setIsLevelMenuOpen] = useState(false);
    const [isStaticMenuOpen, setIsStaticMenuOpen] = useState(false);
    const [isDynamicMenuOpen, setIsDynamicMenuOpen] = useState(false);
    const [placement, setPlacement] = useState<PlacementState>(null);
    const [fps, setFps] = useState(0);

    useEffect(() => {
        if (!canvasRef.current) return;
        const engine = new EditorEngine(canvasRef.current);
        engine.onFpsUpdate = setFps;
        engine.onSelectEntity = setSelectedEntity;
        engine.onToggleLineBuildMode = () => setLineBuildMode(p => p === 'manual' ? 'auto' : 'manual');
        engine.init();
        engineRef.current = engine;
        return () => engine.dispose();
    }, []);

    useEffect(() => { 
        if (tool !== 'create_obj') {
            setPlacement(null);
            setIsStaticMenuOpen(false);
            setIsDynamicMenuOpen(false);
        }
        if (engineRef.current) engineRef.current.tool = tool; 
    }, [tool]);

    useEffect(() => { if (engineRef.current) engineRef.current.lineBuildMode = lineBuildMode; }, [lineBuildMode]);
    useEffect(() => { if (engineRef.current) engineRef.current.isPaused = isPaused; }, [isPaused]);
    useEffect(() => { if (engineRef.current) engineRef.current.setPlacement(placement); }, [placement]);
    useEffect(() => { if (engineRef.current) engineRef.current.selectedEntityId = selectedEntity?.id || null; }, [selectedEntity]);

    const handleDelete = (ent: Entity) => {
        if (!engineRef.current) return;
        deleteEntity(engineRef.current.physics, ent);
        if (selectedEntity?.id === ent.id) setSelectedEntity(null);
    };

    const handleUpdatePhysics = (ent: Entity) => {
        if (!engineRef.current) return;
        updatePhysicsFromUI(engineRef.current.physics, ent);
        setSelectedEntity({...ent});
    };

    return (
        <div style={{ position: 'fixed', inset: 0, color: '#eee', fontFamily: 'monospace', display: 'flex', flexDirection: 'column', userSelect: 'none', background: '#222' }}>
            <div style={{ height: 40, background: '#111', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', padding: '0 15px', gap: 20, zIndex: 10 }}>
                <div style={{ fontWeight: 'bold', color: '#4a90e2' }}>PAJONK V0.1.4</div>
                <div style={{ display: 'flex', gap: 10 }}>
                   <div style={{ position: 'relative' }}>
                       <button onClick={() => setIsLevelMenuOpen(!isLevelMenuOpen)} style={{ background: '#222', color: '#ccc', border: '1px solid #444', padding: '2px 10px', cursor: 'pointer' }}>Level ▾</button>
                       {isLevelMenuOpen && (
                           <div style={{ position: 'absolute', top: '100%', left: 0, background: '#222', border: '1px solid #444', zIndex: 100, display: 'flex', flexDirection: 'column', minWidth: 100 }}>
                               <button onClick={() => { [...world.entities].forEach(handleDelete); setIsLevelMenuOpen(false); }} style={{ padding: '8px 15px', border: 'none', background: 'none', color: '#fff', textAlign: 'left', cursor: 'pointer' }}>New</button>
                               <button onClick={() => setIsLevelMenuOpen(false)} style={{ padding: '8px 15px', border: 'none', background: 'none', color: '#fff', textAlign: 'left', cursor: 'pointer' }}>Save</button>
                               <button onClick={() => setIsLevelMenuOpen(false)} style={{ padding: '8px 15px', border: 'none', background: 'none', color: '#fff', textAlign: 'left', cursor: 'pointer' }}>Load</button>
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
                <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#111', borderRight: '1px solid #333' }}>
                    {showPanels.list && (
                        <div style={{ flex: selectedEntity ? '0 0 250px' : '1', padding: 10, overflowY: 'auto', borderBottom: selectedEntity ? '1px solid #333' : 'none' }}>
                            <div style={{ fontSize: 10, marginBottom: 10, color: '#555', letterSpacing: '1px' }}>SCENE HIERARCHY</div>
                            {world.entities.map(e => (
                                <div key={e.id} onClick={() => setSelectedEntity(e)} style={{ padding: '6px 8px', fontSize: 11, borderLeft: selectedEntity?.id === e.id ? '2px solid #4a90e2' : '2px solid transparent', background: selectedEntity?.id === e.id ? '#1a1a1a' : 'transparent', cursor: 'pointer', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: selectedEntity?.id === e.id ? '#fff' : '#aaa' }}>
                                    {e.name}
                                </div>
                            ))}
                        </div>
                    )}
                    {showPanels.props && selectedEntity && (
                        <div style={{ flex: 1, padding: 12, fontSize: 12, overflowY: 'auto' }}>
                            <div style={{ fontSize: 10, marginBottom: 15, color: '#555', letterSpacing: '1px' }}>PROPERTIES</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span>Name</span>
                                    <input value={selectedEntity.name} onChange={e => { selectedEntity.name = e.target.value; setSelectedEntity({...selectedEntity}); }} style={{ width: 110, background: '#000', color: '#fff', border: '1px solid #333', padding: '4px 6px' }}/>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span>Position</span>
                                    <div style={{ display: 'flex', gap: 4 }}>
                                        <input type="number" value={selectedEntity.position.x} onChange={e => { selectedEntity.position.x = Number(e.target.value); handleUpdatePhysics(selectedEntity); if (selectedEntity.renderable) selectedEntity.renderable.mesh.position.x = selectedEntity.position.x; setSelectedEntity({...selectedEntity}); }} step="0.1" style={{ width: 50, background: '#000', color: '#fff', border: '1px solid #333' }}/>
                                        <input type="number" value={selectedEntity.position.y} onChange={e => { selectedEntity.position.y = Number(e.target.value); handleUpdatePhysics(selectedEntity); if (selectedEntity.renderable) selectedEntity.renderable.mesh.position.y = selectedEntity.position.y; setSelectedEntity({...selectedEntity}); }} step="0.1" style={{ width: 50, background: '#000', color: '#fff', border: '1px solid #333' }}/>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span>Rotation</span>
                                    <input type="number" value={Math.round(THREE.MathUtils.radToDeg(selectedEntity.rotation))} onChange={e => { selectedEntity.rotation = THREE.MathUtils.degToRad(Number(e.target.value)); if (selectedEntity.renderable) selectedEntity.renderable.mesh.rotation.z = selectedEntity.rotation; setSelectedEntity({...selectedEntity}); }} step="5" style={{ width: 104, background: '#000', color: '#fff', border: '1px solid #333', padding: '2px' }}/>
                                </div>
                                {selectedEntity.sdfCollider && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px', background: '#000', borderRadius: 4 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <span>Width / R1</span>
                                            <input type="number" value={selectedEntity.sdfCollider.size.x} onChange={e => { 
                                                selectedEntity.sdfCollider!.size.x = Number(e.target.value); 
                                                setSelectedEntity({...selectedEntity}); 
                                            }} step="0.1" style={{ width: 60, background: '#111', color: '#fff' }}/>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <span>Height / R2</span>
                                            <input type="number" value={selectedEntity.sdfCollider.size.y} onChange={e => { 
                                                selectedEntity.sdfCollider!.size.y = Number(e.target.value); 
                                                setSelectedEntity({...selectedEntity}); 
                                            }} step="0.1" style={{ width: 60, background: '#111', color: '#fff' }}/>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <span>Extra (H/Corner)</span>
                                            <input type="number" value={selectedEntity.scale.x} onChange={e => { selectedEntity.scale.x = Number(e.target.value); setSelectedEntity({...selectedEntity}); }} step="0.1" style={{ width: 60, background: '#111', color: '#fff' }}/>
                                        </div>
                                    </div>
                                )}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span>Friction</span>
                                    <input type="number" value={selectedEntity.friction ?? 0.5} onChange={e => { 
                                        selectedEntity.friction = Number(e.target.value); 
                                        if (selectedEntity.physics?.particleIdx !== undefined) {
                                            engineRef.current?.physics.setParticleFriction(selectedEntity.physics.particleIdx, selectedEntity.friction);
                                            engineRef.current?.physics.syncGPU();
                                        }
                                        setSelectedEntity({...selectedEntity}); 
                                    }} step="0.1" style={{ width: 60, background: '#111', color: '#fff', padding: '2px', border: '1px solid #333' }}/>
                                </div>
                                <button onClick={() => handleDelete(selectedEntity)} style={{ marginTop: 20, background: '#aa3333', color: '#fff', border: 'none', padding: '10px', cursor: 'pointer', fontWeight: 'bold' }}>DELETE OBJECT</button>
                            </div>
                        </div>
                    )}
                </div>

                <div ref={canvasRef} style={{ flex: 1, position: 'relative', background: '#000', overflow: 'hidden' }}>
                   <div style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 2, background: '#111', padding: 3, borderRadius: 4, border: '1px solid #444', zIndex: 20 }}>
                        <button onClick={() => setTool('select')} style={{ background: tool === 'select' ? '#4a90e2' : '#222', color: '#fff', border: 'none', padding: '6px 14px', fontSize: 11, cursor: 'pointer' }}>SELECT</button>
                        <button onClick={() => setTool('build_line')} style={{ background: tool === 'build_line' ? '#4a90e2' : '#222', color: '#fff', border: 'none', padding: '6px 14px', fontSize: 11, cursor: 'pointer' }}>ROPE</button>
                        <div style={{ position: 'relative' }}>
                            <button onClick={() => { setTool('create_obj'); setIsStaticMenuOpen(!isStaticMenuOpen); setIsDynamicMenuOpen(false); }} style={{ background: tool === 'create_obj' && placement?.type === 'static' ? '#4a90e2' : '#222', color: '#fff', border: 'none', padding: '6px 14px', fontSize: 11, cursor: 'pointer' }}>STATIC ▾</button>
                            {isStaticMenuOpen && tool === 'create_obj' && (
                                <div style={{ position: 'absolute', bottom: '100%', left: 0, background: '#111', border: '1px solid #444', display: 'flex', flexDirection: 'column', width: 140, marginBottom: 5 }}>
                                    <button onClick={() => { setPlacement({type: 'static', shape: 'box'}); setIsStaticMenuOpen(false); }} style={{ padding: '8px', background: 'none', border: 'none', color: '#ccc', fontSize: 10, textAlign: 'left', cursor: 'pointer' }}>Static Box</button>
                                    <button onClick={() => { setPlacement({type: 'static', shape: 'circle'}); setIsStaticMenuOpen(false); }} style={{ padding: '8px', background: 'none', border: 'none', color: '#ccc', fontSize: 10, textAlign: 'left', cursor: 'pointer' }}>Static Circ</button>
                                    <button onClick={() => { setPlacement({type: 'static', shape: 'rounded_box'}); setIsStaticMenuOpen(false); }} style={{ padding: '8px', background: 'none', border: 'none', color: '#ccc', fontSize: 10, textAlign: 'left', cursor: 'pointer' }}>Rounded Box</button>
                                    <button onClick={() => { setPlacement({type: 'static', shape: 'capsule'}); setIsStaticMenuOpen(false); }} style={{ padding: '8px', background: 'none', border: 'none', color: '#ccc', fontSize: 10, textAlign: 'left', cursor: 'pointer' }}>Uneven Capsule</button>
                                    <button onClick={() => { setPlacement({type: 'static', shape: 'vesica'}); setIsStaticMenuOpen(false); }} style={{ padding: '8px', background: 'none', border: 'none', color: '#ccc', fontSize: 10, textAlign: 'left', cursor: 'pointer' }}>Vesica</button>
                                </div>
                            )}
                        </div>
                        <div style={{ position: 'relative' }}>
                            <button onClick={() => { setTool('create_obj'); setIsDynamicMenuOpen(!isDynamicMenuOpen); setIsStaticMenuOpen(false); }} style={{ background: tool === 'create_obj' && placement?.type === 'dynamic' ? '#4a90e2' : '#222', color: '#fff', border: 'none', padding: '6px 14px', fontSize: 11, cursor: 'pointer' }}>DYNAMIC ▾</button>
                            {isDynamicMenuOpen && tool === 'create_obj' && (
                                <div style={{ position: 'absolute', bottom: '100%', left: 0, background: '#111', border: '1px solid #444', display: 'flex', flexDirection: 'column', width: 140, marginBottom: 5 }}>
                                    <button onClick={() => { setPlacement({type: 'dynamic', shape: 'circle'}); setIsDynamicMenuOpen(false); }} style={{ padding: '8px', background: 'none', border: 'none', color: '#ccc', fontSize: 10, textAlign: 'left', cursor: 'pointer' }}>Dynamic Ball</button>
                                </div>
                            )}
                        </div>
                        <button onClick={() => setTool('cut_line')} style={{ background: tool === 'cut_line' ? '#4a90e2' : '#222', color: '#fff', border: 'none', padding: '6px 14px', fontSize: 11, cursor: 'pointer' }}>CUT</button>
                   </div>
                   <div style={{ position: 'absolute', top: 10, left: 10, color: '#444', fontSize: 10 }}>FPS: {fps} | Mode: {lineBuildMode.toUpperCase()}</div>
                </div>
            </div>
        </div>
    );
};

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
