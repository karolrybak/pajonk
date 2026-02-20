import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { type Entity } from './ecs';
import { EditorEngine } from './core/EditorEngine';
import { deleteEntity, updatePhysicsFromUI } from './core/EntityFactory';
import type { ToolMode, PlacementState } from './types';
import { TopBar } from './components/TopBar';
import { ObjectList } from './components/ObjectList';
import { ObjectProperties } from './components/ObjectProperties';
import { Toolbar } from './components/Toolbar';

const App = () => {
    const canvasRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<EditorEngine | null>(null);

    const [tool, setTool] = useState<ToolMode>('select');
    const [lineBuildMode, setLineBuildMode] = useState<'manual' | 'auto'>('auto');
    const [isPaused, setIsPaused] = useState(false);
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
        engine.onManualReel = () => setLineBuildMode('manual');
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
            <TopBar 
                isLevelMenuOpen={isLevelMenuOpen} 
                setIsLevelMenuOpen={setIsLevelMenuOpen} 
                isPaused={isPaused} 
                setIsPaused={setIsPaused}
                showPanels={showPanels} 
                setShowPanels={setShowPanels}
                onDeleteEntity={handleDelete}
            />

            <div style={{ flex: 1, position: 'relative', display: 'flex', overflow: 'hidden' }}>
                <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#111', borderRight: '1px solid #333' }}>
                    {showPanels.list && (
                        <ObjectList 
                            selectedEntity={selectedEntity} 
                            setSelectedEntity={setSelectedEntity} 
                        />
                    )}
                    {showPanels.props && selectedEntity && (
                        <ObjectProperties 
                            selectedEntity={selectedEntity} 
                            setSelectedEntity={setSelectedEntity} 
                            onDelete={handleDelete}
                            handleUpdatePhysics={handleUpdatePhysics}
                            engine={engineRef.current}
                        />
                    )}
                </div>

                <div ref={canvasRef} style={{ flex: 1, position: 'relative', background: '#000', overflow: 'hidden' }}>
                   <Toolbar 
                        tool={tool} 
                        setTool={setTool} 
                        placement={placement} 
                        setPlacement={setPlacement}
                        isStaticMenuOpen={isStaticMenuOpen} 
                        setIsStaticMenuOpen={setIsStaticMenuOpen}
                        isDynamicMenuOpen={isDynamicMenuOpen} 
                        setIsDynamicMenuOpen={setIsDynamicMenuOpen}
                   />
                   <div style={{ position: 'absolute', top: 10, left: 10, color: '#444', fontSize: 10 }}>
                        FPS: {fps}
                        {tool === 'build_line' && (
                            <>
                                <span style={{ marginLeft: 10 }}>| </span><br/>
                                <span style={{ color: '#FFF' }}>MODE: {lineBuildMode.toUpperCase()} | MMB: SWITCH MODES | SCROLL: REEL/UNREEL</span>
                            </>
                        )}
                   </div>
                </div>
            </div>
        </div>
    );
};

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
