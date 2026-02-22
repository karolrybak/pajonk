import { addObject } from '../EntityFactory';
import { Tool } from './Tool';

export class CreateObjTool extends Tool {
    onMouseDown(e: MouseEvent, pos: Float32Array) {
        if (e.button !== 0) return;
        const placement = this.engine.placement;
        if (placement && placement.shape && placement.type !== 'joint') {
            addObject(this.engine.physics, placement.type as 'static' | 'dynamic', placement.shape, pos);
        }
    }
}
