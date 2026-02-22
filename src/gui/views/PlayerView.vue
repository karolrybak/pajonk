<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { PlayerEngine } from '@/core/PlayerEngine';

const props = defineProps<{
  levelName: string;
}>();

const canvasRef = ref<HTMLDivElement | null>(null);
const fps = ref(0);
const engine = ref<PlayerEngine | null>(null);
const zyzioData = ref<any>(null);

let lastPos = [0, 0];
let statusInterval: any;

const updateStatus = () => {
  if (!engine.value?.playerRig) return;
  const rig = engine.value.playerRig;
  
  // Safety check for body transform
  if (!rig.body.transform) return;
  
  const pos = [rig.body.transform.position[0], rig.body.transform.position[1]];
  
  // Calculate velocity magnitude (speed)
  const dx = pos[0] - lastPos[0];
  const dy = pos[1] - lastPos[1];
  const speed = Math.sqrt(dx*dx + dy*dy) * 60; // Approximate units/sec based on 60fps loop
  lastPos = [...pos];

  // Detect Orientation based on the local upDir vector
  // This is the surface normal detected by Zyzio's raycasts
  const angle = Math.atan2(rig.upDir[0], rig.upDir[1]) * (180 / Math.PI);
  let orientation = 'FLOOR';
  const absAngle = Math.abs(angle);
  
  if (absAngle > 135) {
    orientation = 'CEILING';
  } else if (angle > 45) {
    orientation = 'LEFT WALL';
  } else if (angle < -45) {
    orientation = 'RIGHT WALL';
  }

  zyzioData.value = {
    grounded: rig.grounded,
    upDir: [rig.upDir[0], rig.upDir[1]],
    pos,
    speed,
    orientation: `${orientation} (${Math.round(angle)}°)`,
    jumpCD: rig.jumpCooldown
  };
};

onMounted(async () => {
  if (!canvasRef.value) return;
  
  const player = new PlayerEngine(canvasRef.value);
  player.onFpsUpdate = (val) => fps.value = val;
  
  try {
    await player.init();
    // await player.spawnPlayer();
    engine.value = player;
    
    // Start diagnostic polling
    statusInterval = setInterval(updateStatus, 50); // 20fps UI update is smooth enough
  } catch (err) {
    console.error('Failed to initialize PlayerEngine:', err);
  }
});

onUnmounted(() => {
  if (engine.value) {
    engine.value.dispose();
  }
  if (statusInterval) clearInterval(statusInterval);
});
</script>

<template>
  <div class="h-screen w-screen bg-black overflow-hidden relative">
    <div ref="canvasRef" class="w-full h-full" />
    
    <!-- FPS Overlay -->
    <div class="absolute top-4 left-4 text-white opacity-50 pointer-events-none text-xs font-mono">
      {{ fps }} FPS
    </div>

    <!-- Zyzio Diagnostic Panel -->
    <div v-if="zyzioData" class="absolute top-4 right-4 w-60 pointer-events-none flex flex-col gap-2 z-10 text-black">
      <UCard :ui="{ body: 'p-3', background: ' backdrop-blur-md', border: 'border-white/10 shadow-xl' }">
        <template #header>
          <div class="text-[10px] font-bold text-white/40 tracking-widest uppercase flex justify-between items-center text-black">
            <span class="text-black">Zyzio Diagnostics</span>
            <div :class="[zyzioData.grounded ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-blue-400', 'w-1.5 h-1.5 rounded-full transition-colors duration-300']" />
          </div>
        </template>

        <div class="flex flex-col gap-2 font-mono text-[10px]">
          <div class="flex justify-between items-center text-black">
            <span>PHYSICS STATE</span>
            <UBadge :color="zyzioData.grounded ? 'success' : 'warning'" size="xs" variant="soft">
              {{ zyzioData.grounded ? 'STICKY' : 'FALLING' }}
            </UBadge>
          </div>
          
          <div class="flex justify-between">
            <span>SURFACE</span>
            <span class="text-primary font-bold">{{ zyzioData.orientation }}</span>
          </div>

          <div class="flex justify-between">
            <span>NORMAL (UP)</span>
            <span class="font-mono text-[9px]">[{{ zyzioData.upDir[0].toFixed(2) }}, {{ zyzioData.upDir[1].toFixed(2) }}]</span>
          </div>

          <div class="flex justify-between">
            <span>COORDINATES</span>
            <span class="">{{ zyzioData.pos[0].toFixed(1) }}, {{ zyzioData.pos[1].toFixed(1) }}</span>
          </div>
          
          <div class="flex justify-between">
            <span>VELOCITY</span>
            <span class="font-bold">{{ zyzioData.speed.toFixed(1) }}u/s</span>
          </div>

          <!-- Jump Cooldown Bar -->
          <div class="flex flex-col gap-1 mt-1">
            <div class="text-[8px] uppercase tracking-tighter">Neural Jump Link Status</div>
            <div class="h-1 bg-white/5 rounded-full overflow-hidden">
               <div 
                 class="h-full bg-primary-500 shadow-[0_0_10px_rgba(var(--color-primary-500),0.5)]"
                 :style="{ width: `${(1.0 - Math.max(0, zyzioData.jumpCD / 0.5)) * 100}%` }" 
               />
            </div>
          </div>
        </div>
      </UCard>

      <div class="text-[9px] text-white font-mono text-center">
        Procedural Gait active • Tripod mode
      </div>
    </div>
  </div>
</template>
