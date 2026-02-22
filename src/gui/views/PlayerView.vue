<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { PlayerEngine } from '@/core/PlayerEngine';

const props = defineProps<{
  levelName: string;
}>();

const canvasRef = ref<HTMLDivElement | null>(null);
const fps = ref(0);
const engine = ref<PlayerEngine | null>(null);

onMounted(async () => {
  if (!canvasRef.value) return;
  
  const player = new PlayerEngine(canvasRef.value);
  player.onFpsUpdate = (val) => fps.value = val;
  
  try {
    await player.init();
    await player.spawnPlayer();
    engine.value = player;
  } catch (err) {
    console.error('Failed to initialize PlayerEngine:', err);
  }
});

onUnmounted(() => {
  if (engine.value) {
    engine.value.dispose();
  }
});
</script>

<template>
  <div class="h-screen w-screen bg-black overflow-hidden relative">
    <div ref="canvasRef" class="w-full h-full" />
    <div class="absolute top-4 left-4 text-white opacity-50 pointer-events-none text-xs font-mono">
      {{ fps }} FPS
    </div>
  </div>
</template>
