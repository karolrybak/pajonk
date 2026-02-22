<script setup lang="ts">
import type { ToolMode, PlacementState } from '@/types';

const props = defineProps<{
  tool: ToolMode;
  placement: PlacementState;
}>();

const emit = defineEmits<{
  (e: 'update:tool', tool: ToolMode): void;
  (e: 'update:placement', placement: PlacementState): void;
}>();

const setTool = (tool: ToolMode, p: PlacementState = null) => {
  emit('update:tool', tool);
  emit('update:placement', p);
};

const items = [
  { label: 'Select', icon: 'i-heroicons-cursor-arrow-rays', click: () => setTool('select') },
  { 
    label: 'Static', icon: 'i-heroicons-square-3-stack-3d', children: [
      { label: 'Box', icon: 'i-heroicons-stop', onSelect: () => setTool('create_obj', { type: 'static', shape: 'box' }) },
      { label: 'Circle', icon: 'i-heroicons-stop-circle', onSelect: () => setTool('create_obj', { type: 'static', shape: 'circle' }) },
    ]
  },
  { 
    label: 'Particle', icon: 'i-heroicons-sparkles', children: [
      { label: 'Circle', icon: 'i-heroicons-stop-circle', onSelect: () => setTool('create_obj', { type: 'dynamic', shape: 'circle' }) },
    ]
  },
  { label: 'Rope', icon: 'i-heroicons-link', click: () => setTool('build_line') },
];
</script>

<template>
  <div class="flex items-center gap-1 p-1 bg-black/80 backdrop-blur-md rounded-lg border border-white/10 shadow-2xl">
    <template v-for="item in items">
      <UDropdownMenu v-if="item.children" :items="[item.children]">
        <UButton 
          variant="ghost" 
          color="neutral" 
          :icon="item.icon" 
          :label="item.label" 
          class="px-3"
        />
      </UDropdownMenu>
      <UButton 
        v-else
        variant="ghost" 
        :color="tool === (item.click ? 'select' : '') ? 'primary' : 'neutral'"
        :icon="item.icon" 
        :label="item.label"
        class="px-3"
        @click="item.click?.()"
      />
    </template>
  </div>
</template>
