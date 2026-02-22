import { vec2 } from 'wgpu-matrix';
import { world } from '../../ecs';
import { Tool } from './Tool';

export class SelectTool extends Tool {
    onMouseDown(e: MouseEvent, pos: Float32Array) {
        if (e.button !== 0) return;
        
        const ent = world.with('transform').entities.find(e => 
            vec2.distance(e.transform!.position, pos) < 0.6
        );

        if (ent) {
            this.engine.selectedEntity = ent;
            this.engine.draggedEntity = ent;
            vec2.sub(ent.transform!.position, pos, this.engine.dragOffset);
            this.engine.onSelectEntity?.(ent);
        } else {
            this.engine.selectedEntity = null; 
            this.engine.onSelectEntity?.(null);
        }
    }

    onMouseMove(e: MouseEvent, pos: Float32Array) {
        if (this.engine.draggedEntity && this.engine.draggedEntity.transform) {
            const ent = this.engine.draggedEntity;
            const newPos = vec2.add(pos, this.engine.dragOffset) as Float32Array;
            ent.transform!.position.set(newPos);
            
            const parentRope = world.with('physicsRope').entities.find(r => 
                r.physicsRope!.segments.includes(ent)
            );
            if (parentRope && !parentRope.tags.includes('building')) {
                parentRope.tags.push('building');
            }
        }
    }
}
