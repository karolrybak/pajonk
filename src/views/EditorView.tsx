import React, { useEffect, useRef, useState } from 'react';
import { EditorEngine } from '../core/EditorEngine';

export const EditorView: React.FC<{ initialLevelName: string }> = ({ initialLevelName }) => {
    const canvasRef = useRef<HTMLDivElement>(null);
    const [fps, setFps] = useState(0);

    useEffect(() => {
        if (!canvasRef.current) return;
        const editor = new EditorEngine(canvasRef.current);
        editor.onFpsUpdate = setFps;
        editor.init().catch(console.error);
        return () => editor.dispose();
    }, []);

    return (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '10px 20px', background: '#111', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', zIndex: 10 }}>
                <span style={{ fontWeight: 'bold', color: '#4a90e2' }}>PAJONK V0.2.0 - EDITOR (PRODUCTION MODE)</span>
                <span style={{ fontSize: 12, color: '#aaa' }}>FPS: {fps}</span>
            </div>
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                <div style={{ width: 250, background: '#1a1a1a', borderRight: '1px solid #333', padding: 15, zIndex: 10 }}>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>CONTROLS</div>
                    <div style={{ fontSize: 12, color: '#ccc' }}>Click on canvas to spawn dynamic objects.</div>
                </div>
                <div ref={canvasRef} style={{ flex: 1, background: '#000', position: 'relative' }} />
            </div>
        </div>
    );
};
