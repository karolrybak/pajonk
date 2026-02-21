import React from 'react';
import { world } from '../ecs';
import { listLevels, saveLevel } from '../core/LevelSystem';
import { EditorEngine } from '../core/EditorEngine';

interface TopBarProps {
    isLevelMenuOpen: boolean;
    setIsLevelMenuOpen: (val: boolean) => void;
    isPaused: boolean;
    setIsPaused: (val: boolean) => void;
    showPanels: { list: boolean; props: boolean };
    setShowPanels: React.Dispatch<React.SetStateAction<{ list: boolean; props: boolean }>>;
    onDeleteEntity: (ent: any) => void;
    engine: EditorEngine | null;
    levelName: string;
    setLevelName: (name: string) => void;
}

export const TopBar: React.FC<TopBarProps> = ({ 
    isLevelMenuOpen, 
    setIsLevelMenuOpen, 
    isPaused, 
    setIsPaused, 
    showPanels, 
    setShowPanels,
    onDeleteEntity,
    engine,
    levelName,
    setLevelName
}) => {
    const [levels, setLevels] = React.useState<string[]>([]);
    const [isLoadMenuOpen, setIsLoadMenuOpen] = React.useState(false);

    const handleSave = async () => {
        if (!engine) return;
        let name = levelName;
        if (!name) {
            name = prompt('Enter level name:') || '';
            if (!name) return;
            window.history.pushState({}, '', `/editor/${name}`);
            setLevelName(name);
        }
        await saveLevel(name, engine.physics);
        return name;
    };

    const handleLoadList = async () => {
        const list = await listLevels();
        setLevels(list);
        setIsLoadMenuOpen(true);
    };

    const handleLoadLevel = async (name: string) => {
        window.location.href = `/editor/${name}`;
    };

    const handleTest = async () => {
        const name = await handleSave();
        if (name) {
            window.open(`/play/${name}`, '_blank');
        }
    };

    return (
        <div style={{ height: 40, background: '#111', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', padding: '0 15px', gap: 20, zIndex: 10 }}>
            <div style={{ fontWeight: 'bold', color: '#4a90e2' }}>PAJONK V0.1.5</div>
            <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ position: 'relative' }}>
                    <button onClick={() => setIsLevelMenuOpen(!isLevelMenuOpen)} style={{ background: '#222', color: '#ccc', border: '1px solid #444', padding: '2px 10px', cursor: 'pointer' }}>Level ▾</button>
                    {isLevelMenuOpen && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, background: '#222', border: '1px solid #444', zIndex: 100, display: 'flex', flexDirection: 'column', minWidth: 100 }}>
                            <button onClick={() => { engine?.clearScene(); setLevelName(''); setIsLevelMenuOpen(false); }} style={{ padding: '8px 15px', border: 'none', background: 'none', color: '#fff', textAlign: 'left', cursor: 'pointer' }}>New</button>
                            <button onClick={handleSave} style={{ padding: '8px 15px', border: 'none', background: 'none', color: '#fff', textAlign: 'left', cursor: 'pointer' }}>Save</button>
                            <button onClick={handleLoadList} style={{ padding: '8px 15px', border: 'none', background: 'none', color: '#fff', textAlign: 'left', cursor: 'pointer' }}>Load ▾</button>
                            {isLoadMenuOpen && (
                                <div style={{ padding: '4px 15px', borderTop: '1px solid #444', display: 'flex', flexDirection: 'column' }}>
                                    {levels.map(name => (
                                        <button key={name} onClick={() => handleLoadLevel(name)} style={{ padding: '4px 0', border: 'none', background: 'none', color: '#4a90e2', textAlign: 'left', cursor: 'pointer', fontSize: '11px' }}>{name}</button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <button onClick={() => setIsPaused(!isPaused)} style={{ background: isPaused ? '#33aa33' : '#aa3333', border: 'none', borderRadius: 3, padding: '2px 12px', fontWeight: 'bold', cursor: 'pointer', color: 'white' }}>{isPaused ? '▶ PLAY' : '■ STOP'}</button>
                <button onClick={handleTest} style={{ background: '#4a90e2', border: 'none', borderRadius: 3, padding: '2px 12px', fontWeight: 'bold', cursor: 'pointer', color: 'white' }}>TEST</button>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 15, fontSize: 11 }}>
                <label style={{ cursor: 'pointer' }}><input type="checkbox" checked={showPanels.list} onChange={() => setShowPanels(p => ({...p, list: !p.list}))}/> List</label>
                <label style={{ cursor: 'pointer' }}><input type="checkbox" checked={showPanels.props} onChange={() => setShowPanels(p => ({...p, props: !p.props}))}/> Props</label>
            </div>
        </div>
    );
};