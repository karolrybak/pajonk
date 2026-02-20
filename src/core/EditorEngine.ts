import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { WebPhysics, CONFIG } from '../webPhysics';
import { getMouseWorld } from '../utils';
import { BOUNDS } from '../constants';
import { world, type Entity } from '../ecs';
import type { ToolMode, PlacementState } from '../types';
import { createSDFMaterial } from '../materials/sdfMaterial';
import { addObject } from './EntityFactory';

export class EditorEngine {
    canvas: HTMLElement;
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    renderer: WebGPURenderer;
    physics: WebPhysics;

    tool: ToolMode = 'select';
    lineBuildMode: 'manual' | 'auto' = 'manual';
    isPaused: boolean = true;
    placement: PlacementState = null;
    selectedEntityId: string | null = null;
    draggedEntity: Entity | null = null;
    dragOffset = new THREE.Vector2();

    ghostMesh: THREE.Mesh | null = null;
    anchorGizmo: THREE.Mesh;
    mouseWorld = new THREE.Vector2();
    alive = true;
    frameCount = 0;
    lastTime = performance.now();

    onFpsUpdate?: (fps: number) => void;
    onSelectEntity?: (ent: Entity | null) => void;
    onToggleLineBuildMode?: () => void;

    constructor(canvas: HTMLElement) {
        this.canvas = canvas;
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-BOUNDS.width/2, BOUNDS.width/2, BOUNDS.height/2, -BOUNDS.height/2, 0.1, 1000);
        this.camera.position.z = 10;
        
        this.renderer = new WebGPURenderer({ antialias: true });
        this.renderer.domElement.style.position = 'absolute';
        this.renderer.domElement.style.top = '0';
        this.renderer.domElement.style.left = '0';
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        canvas.appendChild(this.renderer.domElement);
        
        this.physics = new WebPhysics(this.renderer, this.scene, BOUNDS);
        
        const gizmoGeo = new THREE.RingGeometry(0.1, 0.15, 16);
        const gizmoMat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.8, depthTest: false });
        this.anchorGizmo = new THREE.Mesh(gizmoGeo, gizmoMat);
        this.anchorGizmo.visible = false;
        this.scene.add(this.anchorGizmo);

        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onWheel = this.onWheel.bind(this);
        this.onContextMenu = this.onContextMenu.bind(this);
        this.animate = this.animate.bind(this);
    }

    async init() {
        await this.renderer.init();
        await this.physics.init();
        
        window.addEventListener('mousemove', this.onMouseMove);
        window.addEventListener('mousedown', this.onMouseDown);
        window.addEventListener('mouseup', this.onMouseUp);
        window.addEventListener('contextmenu', this.onContextMenu);
        window.addEventListener('wheel', this.onWheel);
        
        this.animate();
    }

    dispose() {
        this.alive = false;
        window.removeEventListener('mousemove', this.onMouseMove);
        window.removeEventListener('mousedown', this.onMouseDown);
        window.removeEventListener('mouseup', this.onMouseUp);
        window.removeEventListener('contextmenu', this.onContextMenu);
        window.removeEventListener('wheel', this.onWheel);
        if (this.renderer.domElement.parentNode) {
            this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
    }

    setPlacement(placement: PlacementState) {
        this.placement = placement;
        if (this.ghostMesh) {
            this.scene.remove(this.ghostMesh);
            this.ghostMesh = null;
        }
        if (placement && this.physics.ready) {
            if (placement.type === 'static') {
                const shapeTypes = ['circle', 'box', 'rounded_box', 'capsule', 'vesica'];
                const shapeTypeIdx = Math.max(0, shapeTypes.indexOf(placement.shape));
                const initialRadius = placement.shape === 'circle' ? 1.0 : 0.5;
                const initialSize = new THREE.Vector2(2, 2);
                const size = new THREE.Vector2(placement.shape === 'circle' ? initialRadius : initialSize.x, placement.shape === 'circle' ? initialRadius : initialSize.y);
                const extra = new THREE.Vector2(0.2, 0);
                const bounds = Math.max(size.x, size.y) + Math.abs(extra.x) + 1.0;
                
                const { mat, uniforms } = createSDFMaterial(shapeTypeIdx, size, extra, new THREE.Color(0x00ff00), new THREE.Vector2(bounds, bounds), 0.5);
                
                const geo = new THREE.PlaneGeometry(2, 2);
                const mesh = new THREE.Mesh(geo, mat);
                mesh.scale.set(bounds, bounds, 1);
                mesh.userData.uniforms = uniforms;
                mesh.position.set(0, 0, 0.1);
                this.scene.add(mesh);
                this.ghostMesh = mesh;
            } else {
                const geo = new THREE.CircleGeometry(1, 32);
                const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5 });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.scale.set(placement.shape === 'circle' ? 1.0 : 0.5, placement.shape === 'circle' ? 1.0 : 0.5, 1);
                mesh.position.set(0, 0, 0.1);
                this.scene.add(mesh);
                this.ghostMesh = mesh;
            }
        }
    }

    checkPlacementCollision(pos: THREE.Vector2, _shape: string) {
        for (const ent of world.entities) {
            if (!ent.sdfCollider && !ent.physics) continue;
            if (pos.distanceTo(ent.position) < 0.5) return true;
        }
        return false;
    }

    animate() {
        if (!this.alive) return;
        requestAnimationFrame(this.animate);

        const now = performance.now();
        this.frameCount++;
        if (now - this.lastTime >= 1000) {
            this.onFpsUpdate?.(this.frameCount);
            this.frameCount = 0;
            this.lastTime = now;
        }

        for (const ent of world.entities) {
            if (ent.sdfCollider && ent.renderable) {
                const uniforms = ent.renderable.mesh.userData.uniforms;
                if (uniforms) {
                    uniforms.uSize.value.copy(ent.sdfCollider.size);
                    uniforms.uExtra.value.copy(ent.scale);
                    const bounds = Math.max(ent.sdfCollider.size.x, ent.sdfCollider.size.y) + Math.abs(ent.scale.x) + 1.0;
                    ent.renderable.mesh.scale.set(bounds, bounds, 1);
                    uniforms.uMeshScale.value.set(bounds, bounds);
                    if (ent.id === this.selectedEntityId) {
                        uniforms.uColor.value.setHex(0x66bb66);
                    } else {
                        uniforms.uColor.value.setHex(0x444444);
                    }
                }
            }
        }

        if (this.physics.ready) {
            this.physics.paused = this.isPaused;
            if (this.ghostMesh && this.placement) {
                this.ghostMesh.position.set(this.mouseWorld.x, this.mouseWorld.y, 0.1);
                const collided = this.checkPlacementCollision(this.mouseWorld, this.placement.shape);
                const targetColor = collided ? 0xff0000 : 0x00ff00;
                if (this.placement.type === 'static' && this.ghostMesh.userData.uniforms) {
                    this.ghostMesh.userData.uniforms.uColor.value.setHex(targetColor);
                } else {
                    (this.ghostMesh.material as THREE.MeshBasicMaterial).color.setHex(targetColor);
                }
            }
            if (this.tool === 'build_line') {
                const ignore = this.physics.activeRope ? this.physics.activeRope.indices : undefined;
                const anchor = this.physics.findAnchor(this.mouseWorld, ignore);
                if (anchor) {
                    this.anchorGizmo.position.set(anchor.pos.x, anchor.pos.y, 0.2);
                    (this.anchorGizmo.material as THREE.MeshBasicMaterial).color.setHex(0x00ff00);
                } else {
                    this.anchorGizmo.position.set(this.mouseWorld.x, this.mouseWorld.y, 0.2);
                    (this.anchorGizmo.material as THREE.MeshBasicMaterial).color.setHex(0xffaa00);
                }
                this.anchorGizmo.visible = true;
            } else if (this.tool === 'cut_line') {
                const intersection = this.physics.findIntersectingConstraint(this.mouseWorld, 0.5);
                if (intersection) {
                    this.anchorGizmo.position.set(intersection.proj.x, intersection.proj.y, 0.2);
                    (this.anchorGizmo.material as THREE.MeshBasicMaterial).color.setHex(0xff0000);
                } else {
                    this.anchorGizmo.position.set(this.mouseWorld.x, this.mouseWorld.y, 0.2);
                    (this.anchorGizmo.material as THREE.MeshBasicMaterial).color.setHex(0x555555);
                }
                this.anchorGizmo.visible = true;
            } else {
                this.anchorGizmo.visible = false;
            }
            if (this.physics.activeRope && this.tool === 'build_line' && this.lineBuildMode === 'auto') {
                const rope = this.physics.activeRope;
                const tailIdx = rope.indices[rope.indices.length - 1];
                this.physics.setParticlePos(tailIdx, this.mouseWorld);
                let prevPos = this.physics.getParticlePos(rope.indices[rope.indices.length - 2]);
                let safety = 0;
                while (prevPos.distanceTo(this.mouseWorld) > CONFIG.SEGMENT_LENGTH * 1.3 && rope.indices.length < 500 && safety < 10) {
                    this.physics.adjustRopeLength(rope, -1);
                    prevPos = this.physics.getParticlePos(rope.indices[rope.indices.length - 2]);
                    safety++;
                }
            }
            this.physics.syncObstacles();
            this.physics.update(this.mouseWorld);
        }
        this.renderer.render(this.scene, this.camera);
    }

    onMouseMove(e: MouseEvent) {
        const worldPos = getMouseWorld(e, this.canvas, BOUNDS);
        this.mouseWorld.copy(worldPos);
        
        if (this.draggedEntity && this.tool === 'select') {
            const newPos = this.mouseWorld.clone().add(this.dragOffset);
            this.draggedEntity.position.copy(newPos);
            if (this.draggedEntity.physics?.particleIdx !== undefined) {
                this.physics.setParticlePos(this.draggedEntity.physics.particleIdx, newPos);
                this.physics.syncGPU();
            }
            if (this.draggedEntity.renderable) {
                this.draggedEntity.renderable.mesh.position.set(newPos.x, newPos.y, -0.1);
            }
        }
    }

    onMouseDown(e: MouseEvent) {
        if (e.target !== this.renderer.domElement) return;
        const mWorld = getMouseWorld(e, this.canvas, BOUNDS);
        
        if (e.button === 1) {
            this.onToggleLineBuildMode?.();
            return;
        }
        if (!this.physics.ready) return;
        
        if (this.placement && e.button === 0) {
            if (!this.checkPlacementCollision(mWorld, this.placement.shape)) {
                const ent = addObject(this.physics, this.placement.type, this.placement.shape, { position: mWorld.clone() });
                if (ent) this.onSelectEntity?.(ent);
            }
            return;
        }
        
        if (this.tool === 'build_line') {
            const ignore = this.physics.activeRope ? this.physics.activeRope.indices : undefined;
            const anchor = this.physics.findAnchor(mWorld, ignore);
            if (this.physics.activeRope) {
                if (anchor) {
                    this.physics.pinActiveRope(this.physics.activeRope, anchor);
                } else {
                    this.physics.freeActiveRope();
                }
            } else {
                const startAnchor = anchor || { pos: mWorld.clone(), type: 'loose' };
                this.physics.createRope(startAnchor);
            }
        } else if (this.tool === 'cut_line') {
            const intersection = this.physics.findIntersectingConstraint(mWorld, 0.5);
            if (intersection) {
                this.physics.freeConstraint(intersection.index);
                this.physics.syncGPU();
                this.physics.updateVisuals();
            }
        } else if (this.tool === 'select') {
            const pIdx = this.physics.getNearestParticle(mWorld, 0.5);
            const ent = [...world.entities].find(e => e.physics?.particleIdx === pIdx);
            if (ent) {
                this.onSelectEntity?.(ent);
                this.draggedEntity = ent;
                this.dragOffset.copy(ent.position).sub(mWorld);
            } else {
                const statEnt = [...world.entities].find(e => e.sdfCollider && e.position.distanceTo(mWorld) < 1.5);
                this.onSelectEntity?.(statEnt || null);
                if (statEnt) {
                    this.draggedEntity = statEnt;
                    this.dragOffset.copy(statEnt.position).sub(mWorld);
                }
            }
        }
    }

    onMouseUp(e: MouseEvent) {
        if (this.draggedEntity) {
            this.draggedEntity = null;
        }
    }

    onContextMenu(e: MouseEvent) {
        e.preventDefault();
    }

    onWheel(e: WheelEvent) {
        if (e.target === this.renderer.domElement && this.physics.activeRope && this.tool === 'build_line' && this.lineBuildMode === 'manual') {
            this.physics.adjustRopeLength(this.physics.activeRope, e.deltaY);
        }
    }
}
