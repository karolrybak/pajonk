<script setup lang="ts">
import { listLevels, saveLevel } from '@/core/LevelSystem';
import type { EditorEngine } from '@/core/EditorEngine';
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';

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

onMounted(loadLevels);
</script>

<template>
  <div class="p-2 border-b border-white/10 flex items-center gap-2 bg-black/80 backdrop-blur-md z-50">
    <UDropdownMenu :items="[[
      { label: 'New', icon: 'i-heroicons-document-plus', onSelect: () => { engine?.clearScene(); emit('update:levelName', ''); } },
      { label: 'Save', icon: 'i-heroicons-document-check', onSelect: handleSave },
      { label: 'Levels', icon: 'i-heroicons-folder-open', children: levels }
    ]]">
      <UButton color="neutral" variant="ghost" icon="i-heroicons-bars-3" :label="levelName || 'New Level'" />
    </UDropdownMenu>

    <div class="h-4 w-px bg-white/10 mx-2" />

    <UButton 
      :icon="isPaused ? 'i-heroicons-play' : 'i-heroicons-stop'" 
      :color="isPaused ? 'success' : 'error'" 
      variant="ghost"
      @click="emit('update:isPaused', !isPaused)"
    >
      {{ isPaused ? 'Start' : 'Stop' }}
    </UButton>

    <UButton 
      icon="i-heroicons-rocket-launch" 
      variant="ghost" 
      color="neutral"
      @click="handleSave().then(() => levelName && window.open(`/play/${levelName}`, '_blank'))"
    >
      Test
    </UButton>
  </div>
</template>