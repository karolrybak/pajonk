import React, { useState } from 'react';
import type { ToolMode, PlacementState } from '../types';

interface ToolbarProps {
    tool: ToolMode;
    setTool: (tool: ToolMode) => void;
    placement: PlacementState;
    setPlacement: (p: PlacementState) => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ tool, setTool, placement, setPlacement }) => {
    const [activeMenu, setActiveMenu] = useState<string | null>(null);

    const handlePlacement = (type: any, shape: any) => {
        setTool('create_obj');
        setPlacement({ type, shape });
        setActiveMenu(null);
    };

    const btnStyle = (active: boolean) => ({
        background: active ? '#4a90e2' : '#222',
        color: '#fff', border: 'none', padding: '6px 12px', fontSize: 11, cursor: 'pointer'
    });

    const menuStyle = {
        position: 'absolute' as const, bottom: '100%', left: 0, background: '#111', 
        border: '1px solid #444', display: 'flex', flexDirection: 'column' as const, 
        width: 140, marginBottom: 5, zIndex: 110
    };

    const itemStyle = { padding: '8px', background: 'none', border: 'none', color: '#ccc', fontSize: 10, textAlign: 'left' as const, cursor: 'pointer' };

    return (
        <div style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 2, background: '#111', padding: 3, borderRadius: 4, border: '1px solid #444', zIndex: 100 }}>
            <button onClick={() => { setTool('select'); setPlacement(null); }} style={btnStyle(tool === 'select')}>SELECT</button>
            
            <div style={{ position: 'relative' }}>
                <button onClick={() => setActiveMenu(activeMenu === 'static' ? null : 'static')} style={btnStyle(placement?.type === 'static')}>STATIC ▾</button>
                {activeMenu === 'static' && (
                    <div style={menuStyle}>
                        <button onClick={() => handlePlacement('static', 'box')} style={itemStyle}>Static Box</button>
                        <button onClick={() => handlePlacement('static', 'circle')} style={itemStyle}>Static Circle</button>
                    </div>
                )}
            </div>

            <div style={{ position: 'relative' }}>
                <button onClick={() => setActiveMenu(activeMenu === 'dynamic' ? null : 'dynamic')} style={btnStyle(placement?.type === 'dynamic')}>PARTICLE ▾</button>
                {activeMenu === 'dynamic' && (
                    <div style={menuStyle}>
                        <button onClick={() => handlePlacement('dynamic', 'circle')} style={itemStyle}>New Particle</button>
                    </div>
                )}
            </div>

            <button onClick={() => setTool('build_line')} style={btnStyle(tool === 'build_line')}>ROPE</button>
        </div>
    );
};