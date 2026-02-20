import React from 'react';
import { world, type Entity } from '../ecs';

interface ObjectListProps {
    selectedEntity: Entity | null;
    setSelectedEntity: (ent: Entity | null) => void;
}

export const ObjectList: React.FC<ObjectListProps> = ({ selectedEntity, setSelectedEntity }) => (
    <div style={{ flex: selectedEntity ? '0 0 250px' : '1', padding: 10, overflowY: 'auto', borderBottom: selectedEntity ? '1px solid #333' : 'none' }}>
        <div style={{ fontSize: 10, marginBottom: 10, color: '#555', letterSpacing: '1px' }}>SCENE HIERARCHY</div>
        {world.entities.map(e => (
            <div key={e.id} onClick={() => setSelectedEntity(e)} style={{ 
                padding: '6px 8px', 
                fontSize: 11, 
                borderLeft: selectedEntity?.id === e.id ? '2px solid #4a90e2' : '2px solid transparent', 
                background: selectedEntity?.id === e.id ? '#1a1a1a' : 'transparent', 
                cursor: 'pointer', 
                marginBottom: 2, 
                whiteSpace: 'nowrap', 
                overflow: 'hidden', 
                textOverflow: 'ellipsis', 
                color: selectedEntity?.id === e.id ? '#fff' : '#aaa' 
            }}>
                {e.name}
            </div>
        ))}
    </div>
);