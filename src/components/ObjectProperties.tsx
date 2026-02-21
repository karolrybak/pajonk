import React from 'react';
import { type Entity } from '../ecs';

interface ObjectPropertiesProps {
    selectedEntity: Entity;
    setSelectedEntity: (ent: Entity | null) => void;
    onDelete: (ent: Entity) => void;
    handleUpdatePhysics: (ent: Entity) => void;
    engine: any;
}

export const ObjectProperties: React.FC<ObjectPropertiesProps> = ({ selectedEntity }) => (
    <div style={{ flex: 1, padding: 12, fontSize: 12, overflowY: 'auto' }}>
        <div style={{ fontSize: 10, marginBottom: 15, color: '#555', letterSpacing: '1px' }}>PROPERTIES</div>
        <div>Object: {selectedEntity.name}</div>
        <div style={{ color: '#aaa', marginTop: 10, fontSize: 10 }}>WIP: Migrating UI to new ECS Architecture.</div>
    </div>
);
