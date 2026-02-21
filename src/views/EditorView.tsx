import React, { useEffect, useRef, useState } from 'react';
import { EditorEngine } from '../core/EditorEngine';
import { world, type Entity } from '../ecs';
import { ObjectList } from '../components/ObjectList';
import { ObjectProperties } from '../components/ObjectProperties';
import { Toolbar } from '../components/Toolbar';
import type { ToolMode, PlacementState } from '../types';

export const EditorView: React.FC<{ initialLevelName: string }> = ({ initialLevelName }) => {
    const canvasRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<EditorEngine | null>(null);
    const [fps, setFps] = useState(0);
    const [tool, setTool] = useState<ToolMode>('select');
    const [placement, setPlacement] = useState<PlacementState>(null);
    const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);

    useEffect(() => {
        if (!canvasRef.current) return;
        const editor = new EditorEngine(canvasRef.current);
        editor.onFpsUpdate = setFps;
        editor.onSelectEntity = setSelectedEntity;
        editor.init().catch(console.error);
        engineRef.current = editor;
        return () => editor.dispose();
    }, []);

    useEffect(() => {
        if (engineRef.current) engineRef.current.tool = tool;
    }, [tool]);

    useEffect(() => {
        if (engineRef.current) engineRef.current.placement = placement;
    }, [placement]);

    const handleDelete = (ent: Entity) => {
        if (ent.renderable) engineRef.current?.scene.remove(ent.renderable.mesh);
        world.remove(ent);
        setSelectedEntity(null);
    };

    return (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '10px 20px', background: '#111', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', zIndex: 10 }}>
                <span style={{ fontWeight: 'bold', color: '#4a90e2' }}>PAJONK V0.2.1 - EDITOR REBORN</span>
                <span style={{ fontSize: 12, color: '#aaa' }}>FPS: {fps}</span>
            </div>
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
                <div style={{ width: 250, background: '#111', borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', zIndex: 10 }}>
                    <ObjectList selectedEntity={selectedEntity} setSelectedEntity={setSelectedEntity} />
                    {selectedEntity && <ObjectProperties selectedEntity={selectedEntity} setSelectedEntity={setSelectedEntity} onDelete={handleDelete} />}
                </div>
                <div style={{ flex: 1, background: '#000', position: 'relative', overflow: 'hidden' }}>
                    <div ref={canvasRef} style={{ width: '100%', height: '100%' }} />
                    <Toolbar tool={tool} setTool={setTool} placement={placement} setPlacement={setPlacement} />
                </div>
            </div>
        </div>
    );
};
