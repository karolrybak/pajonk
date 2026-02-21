import React from 'react';
import * as THREE from 'three';
import { type Entity } from '../ecs';

interface ObjectPropertiesProps {
    selectedEntity: Entity;
    setSelectedEntity: (ent: Entity | null) => void;
    onDelete: (ent: Entity) => void;
}

export const ObjectProperties: React.FC<ObjectPropertiesProps> = ({ selectedEntity, setSelectedEntity, onDelete }) => {
    const update = () => setSelectedEntity({ ...selectedEntity });

    return (
        <div style={{ flex: 1, padding: 12, fontSize: 12, overflowY: 'auto', borderTop: '1px solid #333' }}>
            <div style={{ fontSize: 10, marginBottom: 15, color: '#555', letterSpacing: '1px' }}>PROPERTIES</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>Name</span>
                    <input value={selectedEntity.name} onChange={e => { selectedEntity.name = e.target.value; update(); }} style={{ width: 110, background: '#000', color: '#fff', border: '1px solid #333', padding: '4px 6px' }}/>
                </div>

                {selectedEntity.transform && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <span>Position</span>
                        <div style={{ display: 'flex', gap: 4 }}>
                            <input type="number" step="0.1" value={selectedEntity.transform.position.x} onChange={e => { selectedEntity.transform!.position.x = Number(e.target.value); update(); }} style={{ width: 50, background: '#000', color: '#fff' }}/>
                            <input type="number" step="0.1" value={selectedEntity.transform.position.y} onChange={e => { selectedEntity.transform!.position.y = Number(e.target.value); update(); }} style={{ width: 50, background: '#000', color: '#fff' }}/>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span>Rotation</span>
                            <input type="number" step="1" value={Math.round(THREE.MathUtils.radToDeg(selectedEntity.transform.rotation))} onChange={e => { selectedEntity.transform!.rotation = THREE.MathUtils.degToRad(Number(e.target.value)); update(); }} style={{ width: 60, background: '#000', color: '#fff' }}/>
                        </div>
                    </div>
                )}

                {selectedEntity.physicsBody && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px', background: '#222', borderRadius: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span>Mass</span>
                            <input type="number" min="0.1" step="0.1" value={selectedEntity.physicsBody.mass} onChange={e => { selectedEntity.physicsBody!.mass = Number(e.target.value); update(); }} style={{ width: 60, background: '#111', color: '#fff' }}/>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span>Friction</span>
                            <input type="number" min="0" max="1" step="0.05" value={selectedEntity.physicsBody.friction} onChange={e => { selectedEntity.physicsBody!.friction = Number(e.target.value); update(); }} style={{ width: 60, background: '#111', color: '#fff' }}/>
                        </div>
                    </div>
                )}

                {selectedEntity.sdfCollider && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <span>SDF Params</span>
                        {selectedEntity.sdfCollider.parameters.map((p, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: 9, color: '#666' }}>Param {i}</span>
                                <input type="number" step="0.1" value={p} onChange={e => { selectedEntity.sdfCollider!.parameters[i] = Number(e.target.value); update(); }} style={{ width: 60, background: '#000', color: '#fff' }}/>
                            </div>
                        ))}
                    </div>
                )}

                <button onClick={() => onDelete(selectedEntity)} style={{ marginTop: 20, background: '#aa3333', color: '#fff', border: 'none', padding: '10px', cursor: 'pointer', fontWeight: 'bold' }}>DELETE OBJECT</button>
            </div>
        </div>
    );
};