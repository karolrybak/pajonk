<script setup lang="ts">
import { listLevels, saveLevel } from '@/core/LevelSystem';
import type { EditorEngine } from '@/core/EditorEngine';
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { LatencyBenchmark, StressBenchmark } from '@/core/Benchmark';

const props = defineProps<{
  engine: EditorEngine | null;
  levelName: string;
  isPaused: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:levelName', name: string): void;
  (e: 'update:isPaused', val: boolean): void;
}>();

const router = useRouter();
const levels = ref<{ label: string, onSelect: () => void }[]>([]);

const handleSave = async () => {
  if (!props.engine) return;
  let name = props.levelName || prompt('Level name:') || '';
  if (!name) return;
  if (!props.levelName) {
    router.push(`/editor/${name}`);
    emit('update:levelName', name);
  }
  await saveLevel(name, props.engine.physics);
};

const loadLevels = async () => {
  const list = await listLevels();
  levels.value = list.map(name => ({
    label: name,
    onSelect: () => router.push(`/editor/${name}`)
  }));
};

const runBenchmark = async () => {
    if (!props.engine?.physics) return;
    console.log("benchmark starting...");
    const results = await LatencyBenchmark.run(props.engine.physics, 100);
    console.log(LatencyBenchmark.formatResults(results));
    alert(LatencyBenchmark.formatResults(results));
};

const runStressTest = async () => {
    if (!props.engine?.physics) return;
    emit('update:isPaused', false);
    await StressBenchmark.run(props.engine.physics);
};

onMounted(loadLevels);
</script>

<template>
  <div>
    <UDropdownMenu :items="[[
      { label: 'New', icon: 'i-heroicons-document-plus', onSelect: () => { engine?.clearScene(); emit('update:levelName', ''); } },
      { label: 'Save', icon: 'i-heroicons-document-check', onSelect: handleSave },
      { label: 'Levels', icon: 'i-heroicons-folder-open', children: levels }
    ]]">
      <UButton color="neutral" variant="ghost" icon="i-heroicons-bars-3" :label="levelName || 'New Level'" />
    </UDropdownMenu>

    

    <UButton 
      :icon="isPaused ? 'i-heroicons-play' : 'i-heroicons-stop'" 
      :color="isPaused ? 'success' : 'error'" 
      variant="ghost"
      @click="emit('update:isPaused', !isPaused)"
    >
    </UButton>
      <UButton icon="i-heroicons-beaker" color="gray" variant="ghost" @click="runBenchmark" title="Latency Benchmark"/>
      <UButton icon="i-heroicons-fire" color="orange" variant="ghost" @click="runStressTest" title="Stress Test (2000 Particles)"/>
    <UButton 
      icon="i-heroicons-rocket-launch" 
      variant="ghost" 
      color="neutral"
      @click="handleSave().then(() => levelName && window.open(`/play/${levelName}`, '_blank'))"
    >
     
    </UButton>
  </div>
</template>