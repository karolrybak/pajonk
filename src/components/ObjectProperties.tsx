import React from 'react';
import * as THREE from 'three';
import { type Entity } from '../ecs';
import { EditorEngine } from '../core/EditorEngine';

interface ObjectPropertiesProps {
    selectedEntity: Entity;
    setSelectedEntity: (ent: Entity | null) => void;
    onDelete: (ent: Entity) => void;
    handleUpdatePhysics: (ent: Entity) => void;
    engine: EditorEngine | null;
}

export const ObjectProperties: React.FC<ObjectPropertiesProps> = ({ selectedEntity, setSelectedEntity, onDelete, handleUpdatePhysics, engine }) => (
    <div style={{ flex: 1, padding: 12, fontSize: 12, overflowY: 'auto' }}>
        <div style={{ fontSize: 10, marginBottom: 15, color: '#555', letterSpacing: '1px' }}>PROPERTIES</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Name</span>
                <input value={selectedEntity.name} onChange={e => { selectedEntity.name = e.target.value; setSelectedEntity({...selectedEntity}); }} style={{ width: 110, background: '#000', color: '#fff', border: '1px solid #333', padding: '4px 6px' }}/>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Position</span>
                <div style={{ display: 'flex', gap: 4 }}>
                    <input type="number" value={selectedEntity.position.x} onChange={e => { selectedEntity.position.x = Number(e.target.value); handleUpdatePhysics(selectedEntity); if (selectedEntity.renderable) selectedEntity.renderable.mesh.position.x = selectedEntity.position.x; setSelectedEntity({...selectedEntity}); }} step="0.1" style={{ width: 50, background: '#000', color: '#fff', border: '1px solid #333' }}/>
                    <input type="number" value={selectedEntity.position.y} onChange={e => { selectedEntity.position.y = Number(e.target.value); handleUpdatePhysics(selectedEntity); if (selectedEntity.renderable) selectedEntity.renderable.mesh.position.y = selectedEntity.position.y; setSelectedEntity({...selectedEntity}); }} step="0.1" style={{ width: 50, background: '#000', color: '#fff', border: '1px solid #333' }}/>
                </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Rotation</span>
                <input type="number" value={Math.round(THREE.MathUtils.radToDeg(selectedEntity.rotation))} onChange={e => { selectedEntity.rotation = THREE.MathUtils.degToRad(Number(e.target.value)); if (selectedEntity.renderable) selectedEntity.renderable.mesh.rotation.z = selectedEntity.rotation; setSelectedEntity({...selectedEntity}); }} step="1" style={{ width: 104, background: '#000', color: '#fff', border: '1px solid #333', padding: '2px' }}/>
            </div>
            {selectedEntity.sdfCollider && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px', background: '#000', borderRadius: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>Width / R1</span>
                        <input type="number" min="0.1" max="100" step="0.1" value={selectedEntity.sdfCollider.size.x} onChange={e => { selectedEntity.sdfCollider!.size.x = Number(e.target.value); setSelectedEntity({...selectedEntity}); }} style={{ width: 60, background: '#111', color: '#fff' }}/>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>Height / R2</span>
                        <input type="number" min="0.1" max="100" step="0.1" value={selectedEntity.sdfCollider.size.y} onChange={e => { selectedEntity.sdfCollider!.size.y = Number(e.target.value); setSelectedEntity({...selectedEntity}); }} style={{ width: 60, background: '#111', color: '#fff' }}/>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>Extra (H/Corner)</span>
                        <input type="number" min="0" max="100" step="0.1" value={selectedEntity.scale.x} onChange={e => { selectedEntity.scale.x = Number(e.target.value); setSelectedEntity({...selectedEntity}); }} style={{ width: 60, background: '#111', color: '#fff' }}/>
                    </div>
                </div>
            )}
            {selectedEntity.physics && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>Mass</span>
                    <input type="number" min="0.1" max="1000" step="0.1" value={selectedEntity.physics.mass} onChange={e => { 
                        const m = Math.max(0.1, Number(e.target.value));
                        selectedEntity.physics!.mass = m;
                        selectedEntity.physics!.invMass = 1.0 / m;
                        if (selectedEntity.physics!.particleIdx !== undefined) {
                            engine?.physics.setParticleInvMass(selectedEntity.physics.particleIdx, 1.0 / m);
                            engine?.physics.syncGPU();
                        }
                        setSelectedEntity({...selectedEntity}); 
                    }} style={{ width: 60, background: '#111', color: '#fff', padding: '2px', border: '1px solid #333' }}/>
                </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Friction</span>
                <input type="number" min="0" max="2" step="0.05" value={selectedEntity.friction ?? 0.5} onChange={e => { 
                    selectedEntity.friction = Number(e.target.value); 
                    if (selectedEntity.physics?.particleIdx !== undefined) {
                        engine?.physics.setParticleFriction(selectedEntity.physics.particleIdx, selectedEntity.friction);
                        engine?.physics.syncGPU();
                    }
                    setSelectedEntity({...selectedEntity}); 
                }} style={{ width: 60, background: '#111', color: '#fff', padding: '2px', border: '1px solid #333' }}/>
            </div>
            <button onClick={() => onDelete(selectedEntity)} style={{ marginTop: 20, background: '#aa3333', color: '#fff', border: 'none', padding: '10px', cursor: 'pointer', fontWeight: 'bold' }}>DELETE OBJECT</button>
        </div>
    </div>
);