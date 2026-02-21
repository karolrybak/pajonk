import React, { useEffect, useRef, useState } from 'react';
import { EditorEngine } from '../core/EditorEngine';
import { world, type Entity } from '../ecs';
import { ObjectList } from '../components/ObjectList';
import { ObjectProperties } from '../components/ObjectProperties';
import { Toolbar } from '../components/Toolbar';
import { TopBar } from '../components/TopBar';
import { type ToolMode, type PlacementState } from '../types';

export const EditorView: React.FC<{ initialLevelName: string }> = ({ initialLevelName }) => {
    const canvasRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<EditorEngine | null>(null);
    const [fps, setFps] = useState(0);
    const [tool, setTool] = useState<ToolMode>('select');
    const [placement, setPlacement] = useState<PlacementState>(null);
    const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
    const [isPaused, setIsPaused] = useState(true);
    const [isLevelMenuOpen, setIsLevelMenuOpen] = useState(false);
    const [showPanels, setShowPanels] = useState({ list: true, props: true });
    const [levelName, setLevelName] = useState(initialLevelName);
    const [ropeState, setRopeState] = useState<{ mode: string, segments: number } | null>(null);

    useEffect(() => {
        if (!canvasRef.current) return;
        const editor = new EditorEngine(canvasRef.current);
        editor.onFpsUpdate = setFps;
        editor.onSelectEntity = setSelectedEntity;
        editor.onRopeStateChange = () => {
            if (editor.activeRope) {
                setRopeState({ 
                    mode: editor.ropeMode.toUpperCase(), 
                    segments: editor.activeRope.physicsRope?.segments.length || 0 
                });
            } else {
                setRopeState(null);
            }
        };
        editor.init().catch(console.error);
        engineRef.current = editor;
        return () => editor.dispose();
    }, []);

    useEffect(() => {
        if (engineRef.current) {
             if (engineRef.current.tool === 'build_line' && tool !== 'build_line') {
                  engineRef.current.cancelRope();
             }
             engineRef.current.tool = tool;
        }
    }, [tool]);

    useEffect(() => {
        if (engineRef.current) engineRef.current.placement = placement;
    }, [placement]);

    useEffect(() => {
        if (engineRef.current) engineRef.current.isPaused = isPaused;
    }, [isPaused]);

    const handleDelete = (ent: Entity) => {
        if (ent.physicsRope) {
            for (const seg of ent.physicsRope.segments) world.remove(seg);
            const ropeConstraints = world.entities.filter(e => 
                e.physicsConstraint && 
                (ent.physicsRope!.segments.includes(e.physicsConstraint.targetA) || 
                 (!(e.physicsConstraint.targetB instanceof Float32Array) && ent.physicsRope!.segments.includes(e.physicsConstraint.targetB as any)))
            );
            for (const c of ropeConstraints) world.remove(c);
        }
        world.remove(ent);
        setSelectedEntity(null);
    };

    return (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <TopBar 
                isPaused={isPaused} 
                setIsPaused={setIsPaused} 
                isLevelMenuOpen={isLevelMenuOpen} 
                setIsLevelMenuOpen={setIsLevelMenuOpen}
                showPanels={showPanels}
                setShowPanels={setShowPanels}
                engine={engineRef.current}
                levelName={levelName}
                setLevelName={setLevelName}
                onDeleteEntity={handleDelete}
            />
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
                {showPanels.list && (
                    <div style={{ width: 250, background: '#111', borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', zIndex: 10 }}>
                        <ObjectList selectedEntity={selectedEntity} setSelectedEntity={setSelectedEntity} />
                        {showPanels.props && selectedEntity && <ObjectProperties selectedEntity={selectedEntity} setSelectedEntity={setSelectedEntity} onDelete={handleDelete} />}
                    </div>
                )}
                <div style={{ flex: 1, background: '#000', position: 'relative', overflow: 'hidden' }}>
                    <div ref={canvasRef} style={{ width: '100%', height: '100%' }} />
                    
                    {ropeState && (
                        <div style={{ position: 'absolute', top: 20, left: 20, background: 'rgba(0,0,0,0.6)', padding: '8px 15px', pointerEvents: 'none', fontSize: 11, color: '#888', zIndex: 100, borderLeft: '3px solid #4a90e2' }}>
                             <span style={{ color: '#aaa' }}>FPS: {fps} | </span>
                             MODE: <span style={{ color: '#fff' }}>{ropeState.mode}</span> | 
                             SEGMENTS: <span style={{ color: '#fff' }}>{ropeState.segments} / 100</span>
                        </div>
                    )}

                    <Toolbar tool={tool} setTool={setTool} placement={placement} setPlacement={setPlacement} />
                </div>
            </div>
        </div>
    );
};