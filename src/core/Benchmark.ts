import { WebPhysics } from '../webPhysics';
import { world } from '../ecs';
import { addObject } from './EntityFactory';
import { RopeSystem } from './RopeSystem';

export interface BenchmarkResults {
    avg: number;
    min: number;
    max: number;
    jitter: number;
    samples: number[];
}

export class LatencyBenchmark {
    static async run(physics: WebPhysics, count: number = 60): Promise<BenchmarkResults> {
        const samples: number[] = [];
        
        // Warmup
        for (let i = 0; i < 5; i++) {
            await physics.ping(i);
        }

        for (let i = 0; i < count; i++) {
            const start = performance.now();
            await physics.ping(i);
            const end = performance.now();
            samples.push(end - start);
        }

        const min = Math.min(...samples);
        const max = Math.max(...samples);
        const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
        
        // Jitter (mean absolute deviation from avg)
        const jitter = samples.reduce((a, b) => a + Math.abs(b - avg), 0) / samples.length;

        return { avg, min, max, jitter, samples };
    }

    static formatResults(res: BenchmarkResults): string {
        return `GPU Readback Latency:\n` +
               `Avg: ${res.avg.toFixed(2)}ms\n` +
               `Min: ${res.min.toFixed(2)}ms\n` +
               `Max: ${res.max.toFixed(2)}ms\n` +
               `Jitter: ${res.jitter.toFixed(2)}ms\n` +
               `Approx Frames Delay: ${Math.round(res.avg / (1000/60))} frames`;
    }
}

export class StressBenchmark {
    static async run(physics: WebPhysics) {
        // 1. Clear scene
        const entities = [...world.entities];
        for (const ent of entities) world.remove(ent);

        // 2. Spawn Static Floor
        addObject(physics, 'static', 'box', new Float32Array([0, -6]), 1.0, 1);
        addObject(physics, 'static', 'circle', new Float32Array([-5, -3]), 1.5, 1);
        addObject(physics, 'static', 'circle', new Float32Array([5, -3]), 1.5, 1);

        // 3. Spawn Grid of Particles with Constraints (Cloth Simulation style)
        const rows = 100;
        const cols = 50;
        const spacing = 0.3;
        const startX = -(cols * spacing) / 2;
        const startY = 5;

        const grid: any[][] = [];

        for (let y = 0; y < rows; y++) {
            grid[y] = [];
            for (let x = 0; x < cols; x++) {
                const pos = new Float32Array([startX + x * spacing, startY - y * spacing]);
                const p = addObject(physics, 'dynamic', 'circle', pos, 0.1, 2);
                p.physicsBody!.mass = 0.1;
                grid[y][x] = p;

                // Link to left
                if (x > 0) {
                    RopeSystem.createLink(grid[y][x-1], p, spacing, 0.0001);
                }
                // Link to top
                if (y > 0) {
                    RopeSystem.createLink(grid[y-1][x], p, spacing, 0.0001);
                }
            }
        }

        // Pin the top row
        for (let x = 0; x < cols; x += 5) {
            grid[0][x].physicsBody.mass = 0;
            grid[0][x].physicsBody.isDirty = true;
        }

        console.log(`Stress test started: ${world.entities.length} entities spawned.`);
    }
}