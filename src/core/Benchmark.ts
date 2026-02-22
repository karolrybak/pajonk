import { WebPhysics } from '../webPhysics';

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