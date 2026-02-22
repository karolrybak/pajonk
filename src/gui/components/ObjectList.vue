<script setup lang="ts">
import { world, type Entity } from '@/ecs';
import { onMounted, onUnmounted, ref } from 'vue';

const props = defineProps<{
  selectedEntity: Entity | null;
}>();

const emit = defineEmits<{
  (e: 'select', entity: Entity | null): void;
}>();

const entities = ref<Entity[]>([]);

const updateEntities = () => {
  entities.value = Array.from(world.with('editor_ui'));
};

let interval: any;

onMounted(() => {
  updateEntities();
  interval = setInterval(updateEntities, 100);
});

onUnmounted(() => {
  clearInterval(interval);
});
</script>

<template>
  <div>
    <div>
      Scene Hierarchy
    </div>
    
    <div>
      <div v-if="entities.length === 0">
        No entities in scene
      </div>
      
      <div
        v-for="entity in entities"
        :key="entities.indexOf(entity)"
        @click="emit('select', entity)"
      >
        {{ entity.name || 'Unnamed Entity' }}
      </div>
    </div>
  </div>
</template>
