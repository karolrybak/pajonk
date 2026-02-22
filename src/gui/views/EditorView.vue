<script setup lang="ts">
import { ref, shallowRef, onMounted, onUnmounted, watch } from 'vue';
import { EditorEngine } from '@/core/EditorEngine';
import { world, type Entity } from '@/ecs';
import ObjectList from '@/gui/components/ObjectList.vue';
import ObjectProperties from '@/gui/components/ObjectProperties.vue';
import Toolbar from '@/gui/components/Toolbar.vue';
import TopMenu from '@/gui/components/TopMenu.vue';
import type { ToolMode, PlacementState } from '@/types';

const props = defineProps<{
  initialLevelName: string;
}>();

const canvasRef = ref<HTMLDivElement | null>(null);
const engine = ref<EditorEngine | null>(null);
const fps = ref(0);
const tool = ref<ToolMode>('select');
const placement = ref<PlacementState>(null);
const selectedEntity = shallowRef<Entity | null>(null);
const isPaused = ref(true);
const levelName = ref(props.initialLevelName);
const ropeState = ref<{ mode: string, segments: number } | null>(null);

onMounted(async () => {
  if (!canvasRef.value) return;
  
  const editor = new EditorEngine(canvasRef.value);
  editor.onFpsUpdate = (val) => fps.value = val;
  editor.onSelectEntity = (ent) => selectedEntity.value = ent;
  editor.onRopeStateChange = () => {
    const ropeTool = editor.tools['build_line'] as any;
    if (ropeTool && ropeTool.activeRope) {
      ropeState.value = { 
        mode: ropeTool.ropeMode.toUpperCase(), 
        segments: ropeTool.activeRope.physicsRope?.segments.length || 0 
      };
    } else {
      ropeState.value = null;
    }
  };
  
  await editor.init();
  engine.value = editor;
  
  // Initial state sync
  editor.tool = tool.value;
  editor.placement = placement.value;
  editor.isPaused = isPaused.value;
});

onUnmounted(() => {
  if (engine.value) {
    engine.value.dispose();
  }
});

watch(tool, (newTool) => {
  if (engine.value) {
    engine.value.tool = newTool;
  }
});

watch(placement, (newPlacement) => {
  if (engine.value) engine.value.placement = newPlacement;
});

watch(isPaused, (newPaused) => {
  if (engine.value) engine.value.isPaused = newPaused;
});

const handleDelete = (ent: Entity) => {
  if (ent.physicsRope) {
    for (const seg of ent.physicsRope.segments) world.remove(seg);
    const ropeConstraints = world.entities.filter(e => 
      e.physicsConstraint && 
      (ent.physicsRope!.segments.includes(e.physicsConstraint.targetA) || 
       (!(e.physicsConstraint.targetB instanceof Float32Array) && ent.physicsRope!.segments.includes(e.physicsConstraint.targetB as any)))
    );
    for (const c of ropeConstraints) world.remove(c);
  }

  const attachedConstraints = world.entities.filter(e => 
    e.physicsConstraint && 
    (e.physicsConstraint.targetA === ent || 
     e.physicsConstraint.targetB === ent ||
     e.physicsConstraint.targetC === ent)
  );
  for (const c of attachedConstraints) world.remove(c);

  world.remove(ent);
  selectedEntity.value = null;
  
  if (engine.value) {
    if (engine.value.selectedEntity === ent) engine.value.selectedEntity = null;
    if (engine.value.draggedEntity === ent) engine.value.draggedEntity = null;
  }
};

const handleUpdate = () => {
  // Trigger any necessary engine updates if needed, though most properties are reactive via shared objects
};

watch(() => props.initialLevelName, (newName) => {
  levelName.value = newName;
});
const open = ref(true);
</script>

<template>
<UDashboardGroup>
  <UDashboardSidebar id="default" v-model:open="open" collapsible resizable
    :ui="{ footer: 'lg:border-t lg:border-default' }">
    <template #header="{ collapsed }">
      <TopMenu v-model:level-name="levelName" v-model:is-paused="isPaused"
        :engine="engine" />
    </template>

    <template #default="{ collapsed }">
      <ObjectList
        :selected-entity="selectedEntity" @select="selectedEntity = $event" />
    </template>

    <template #footer="{ collapsed }">
      <ObjectProperties v-if="selectedEntity"
       
        :selected-entity="selectedEntity" @update="handleUpdate" @delete="handleDelete" />
    </template>
  </UDashboardSidebar>
  <div class="absolute bottom-8 left-1/2 -translate-x-1/2 border-black bg-white  border-1 rounded z-10">
    <Toolbar v-model:tool="tool" v-model:placement="placement" />
  </div>

  <div class="text-xs absolute right-5 top-1 z-10 text-white">
    ROPE: {{ ropeState ? `${ropeState.mode} (${ropeState.segments})` : 'OFF' }} | FPS: {{ fps }}
  </div>
  <div ref="canvasRef" class="w-full h-full" />
</UDashboardGroup>
</template>