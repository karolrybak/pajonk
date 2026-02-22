<script setup lang="ts">
import { world, type Entity } from '@/ecs';
import { onMounted, onUnmounted, ref, computed } from 'vue';

const props = defineProps<{
  selectedEntity: Entity | null;
}>();

const emit = defineEmits<{
  (e: 'select', entity: Entity | null): void;
  (e: 'delete', entity: Entity): void;
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

const iconFor = (ent: Entity) => {
  if (ent.physicsRope) return 'i-heroicons-link';
  if (ent.physicsConstraint) return 'i-heroicons-paper-clip';
  if (ent.staticBody) return 'i-heroicons-stop';
  if (ent.physicsBody) return 'i-heroicons-sparkles';
  return 'i-heroicons-cube';
};

const treeItems = computed(() =>
  entities.value.map((ent, i) => ({
    label: ent.name || 'Unnamed Entity',
    icon: iconFor(ent),
    value: String(i),
    _entity: ent,
    onSelect: () => emit('select', ent)
  }))
);

const onSelect = (item: any) => {
  emit('select', item._entity ?? null);
};
</script>

<template>
  <UTree
    :items="treeItems"
    @select="onSelect"
    class="w-full"
  >
    <template #item-trailing="{ item }">
      <UButton
        icon="i-heroicons-trash"
        color="error"
        variant="ghost"
        size="xs"
        class="opacity-0 group-hover:opacity-100 transition-opacity"
        @click.stop="emit('delete', item._entity)"
      />
    </template>
  </UTree>
</template>
