<script setup lang="ts">
import { computed } from 'vue';
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

const activeId = computed(() => {
  if (props.tool === 'select') return 'select';
  if (props.tool === 'build_line') return 'rope';
  if (props.tool === 'joint') return 'joint';
  if (props.tool === 'create_obj') {
    return props.placement?.type === 'static' ? 'static' : 'particle';
  }
  return null;
});

const items = [
  { id: 'select', label: 'Select', icon: 'i-heroicons-cursor-arrow-rays', click: () => setTool('select') },
  { 
    id: 'static',
    label: 'Static', icon: 'i-heroicons-square-3-stack-3d', children: [
      { label: 'Box', icon: 'i-heroicons-stop', onSelect: () => setTool('create_obj', { type: 'static', shape: 'box' }) },
      { label: 'Circle', icon: 'i-heroicons-stop-circle', onSelect: () => setTool('create_obj', { type: 'static', shape: 'circle' }) },
    ]
  },
  { 
    id: 'particle',
    label: 'Particle', icon: 'i-heroicons-sparkles', children: [
      { label: 'Circle', icon: 'i-heroicons-stop-circle', onSelect: () => setTool('create_obj', { type: 'dynamic', shape: 'circle' }) },
    ]
  },
  { id: 'rope', label: 'Rope', icon: 'i-heroicons-link', click: () => setTool('build_line') },
  { 
    id: 'joint',
    label: 'Joint', icon: 'i-heroicons-paper-clip', children: [
      { label: 'Anchor', icon: 'i-heroicons-map-pin', onSelect: () => setTool('joint', { type: 'joint', subtype: 'anchor' }) },
      { label: 'Distance', icon: 'i-heroicons-arrows-right-left', onSelect: () => setTool('joint', { type: 'joint', subtype: 'distance' }) },
      { label: 'Inequality', icon: 'i-heroicons-arrows-pointing-out', onSelect: () => setTool('joint', { type: 'joint', subtype: 'inequality' }) },
      { label: 'Angular', icon: 'i-heroicons-arrow-path', onSelect: () => setTool('joint', { type: 'joint', subtype: 'angular' }) },
      { label: 'Area', icon: 'i-heroicons-stop-circle', onSelect: () => setTool('joint', { type: 'joint', subtype: 'area' }) },
    ]
  },
];
</script>

<template>
  <div class="flex items-center gap-1 p-1 backdrop-blur-md rounded-lg border border-white/10 shadow-2xl">
    <template v-for="item in items" :key="item.id">
      <UDropdownMenu v-if="item.children" :items="[item.children]">
        <UButton 
          variant="ghost" 
          :color="activeId === item.id ? 'primary' : 'neutral'"
          :icon="item.icon" 
          :label="item.label" 
          class="px-3"
        />
      </UDropdownMenu>
      <UButton 
        v-else
        variant="ghost" 
        :color="activeId === item.id ? 'primary' : 'neutral'"
        :icon="item.icon" 
        :label="item.label"
        class="px-3"
        @click="item.click?.()"
      />
    </template>
  </div>
</template>
