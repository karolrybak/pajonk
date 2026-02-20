import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { wgslFn, uniform, positionLocal } from 'three/tsl';

export const sdfMaterialFn = wgslFn(`
    fn sdfMaterial(
        vLocal: vec2<f32>, 
        uShapeType: f32, 
        uSize: vec2<f32>, 
        uExtra: vec2<f32>, 
        uColor: vec3<f32>
    ) -> vec4<f32> {
        var d = 1000.0;
        if (uShapeType < 0.5) { 
            d = length(vLocal) - uSize.x;
        } else if (uShapeType < 1.5) { 
            let q = abs(vLocal) - uSize * 0.5;
            d = length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0);
        } else if (uShapeType < 2.5) { 
            let q = abs(vLocal) - uSize * 0.5 + uExtra.x;
            d = min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - uExtra.x;
        } else if (uShapeType < 3.5) { 
            let px = abs(vLocal.x);
            let b = (uSize.x - uSize.y) / uExtra.x;
            let a = sqrt(max(0.0, 1.0 - b * b));
            let k = dot(vec2<f32>(px, vLocal.y), vec2<f32>(-b, a));
            if (k < 0.0) {
                d = length(vec2<f32>(px, vLocal.y)) - uSize.x;
            } else if (k > a * uExtra.x) {
                d = length(vec2<f32>(px, vLocal.y - uExtra.x)) - uSize.y;
            } else {
                d = dot(vec2<f32>(px, vLocal.y), vec2<f32>(a, b)) - uSize.x;
            }
        } else { 
            let pa = abs(vLocal);
            let b = sqrt(max(0.0, uSize.x * uSize.x - uSize.y * uSize.y));
            if ((pa.y * uSize.y) > (pa.x * b + uSize.y * uSize.y)) {
                d = length(pa - vec2<f32>(0.0, b));
            } else {
                d = length(pa - vec2<f32>(-uSize.y, 0.0)) - uSize.x;
            }
        }
        
        let alpha = smoothstep(0.03, -0.03, d);
        let finalColor = mix(uColor * 0.6, uColor, smoothstep(-0.15, -0.05, d));
        return vec4<f32>(finalColor, alpha);
    }
`);

export const createSDFMaterial = (shapeType: number, size: THREE.Vector2, extra: THREE.Vector2, col: THREE.Color, meshScale: THREE.Vector2, opacity: number = 1.0) => {
    const uShapeType = uniform(shapeType);
    const uSize = uniform(size.clone());
    const uExtra = uniform(extra.clone());
    const uColor = uniform(col.clone());
    const uMeshScale = uniform(meshScale.clone());
    const uOpacity = uniform(opacity);

    const vLocal = positionLocal.xy.mul(uMeshScale);
    
    const sdfResult = sdfMaterialFn({
        vLocal,
        uShapeType,
        uSize,
        uExtra,
        uColor
    });

    const mat = new MeshBasicNodeMaterial({ transparent: true });
    mat.colorNode = sdfResult.xyz;
    mat.opacityNode = sdfResult.w.mul(uOpacity);
    
    return { mat, uniforms: { uShapeType, uSize, uExtra, uColor, uMeshScale, uOpacity } };
};
