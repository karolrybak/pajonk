import React from 'react';
import type { ToolMode, PlacementState } from '../types';

interface ToolbarProps {
    tool: ToolMode;
    setTool: (tool: ToolMode) => void;
    placement: PlacementState;
    setPlacement: (p: PlacementState) => void;
    isStaticMenuOpen: boolean;
    setIsStaticMenuOpen: (v: boolean) => void;
    isDynamicMenuOpen: boolean;
    setIsDynamicMenuOpen: (v: boolean) => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ 
    tool, 
    setTool, 
    placement, 
    setPlacement, 
    isStaticMenuOpen, 
    setIsStaticMenuOpen, 
    isDynamicMenuOpen, 
    setIsDynamicMenuOpen 
}) => (
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
);