import React from 'react';
import { world } from '../ecs';

interface TopBarProps {
    isLevelMenuOpen: boolean;
    setIsLevelMenuOpen: (val: boolean) => void;
    isPaused: boolean;
    setIsPaused: (val: boolean) => void;
    showPanels: { list: boolean; props: boolean };
    setShowPanels: React.Dispatch<React.SetStateAction<{ list: boolean; props: boolean }>>;
    onDeleteEntity: (ent: any) => void;
}

export const TopBar: React.FC<TopBarProps> = ({ 
    isLevelMenuOpen, 
    setIsLevelMenuOpen, 
    isPaused, 
    setIsPaused, 
    showPanels, 
    setShowPanels,
    onDeleteEntity
}) => (
    <div style={{ height: 40, background: '#111', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', padding: '0 15px', gap: 20, zIndex: 10 }}>
        <div style={{ fontWeight: 'bold', color: '#4a90e2' }}>PAJONK V0.1.5</div>
        <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ position: 'relative' }}>
                <button onClick={() => setIsLevelMenuOpen(!isLevelMenuOpen)} style={{ background: '#222', color: '#ccc', border: '1px solid #444', padding: '2px 10px', cursor: 'pointer' }}>Level ▾</button>
                {isLevelMenuOpen && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, background: '#222', border: '1px solid #444', zIndex: 100, display: 'flex', flexDirection: 'column', minWidth: 100 }}>
                        <button onClick={() => { [...world.entities].forEach(onDeleteEntity); setIsLevelMenuOpen(false); }} style={{ padding: '8px 15px', border: 'none', background: 'none', color: '#fff', textAlign: 'left', cursor: 'pointer' }}>New</button>
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
);