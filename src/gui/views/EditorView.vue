<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
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
const selectedEntity = ref<Entity | null>(null);
const isPaused = ref(true);
const levelName = ref(props.initialLevelName);
const ropeState = ref<{ mode: string, segments: number } | null>(null);

onMounted(async () => {
  if (!canvasRef.value) return;
  
  const editor = new EditorEngine(canvasRef.value);
  editor.onFpsUpdate = (val) => fps.value = val;
  editor.onSelectEntity = (ent) => selectedEntity.value = ent;
  editor.onRopeStateChange = () => {
    if (editor.activeRope) {
      ropeState.value = { 
        mode: editor.ropeMode.toUpperCase(), 
        segments: editor.activeRope.physicsRope?.segments.length || 0 
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
    if (engine.value.tool === 'build_line' && newTool !== 'build_line') {
      engine.value.cancelRope();
    }
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
  world.remove(ent);
  selectedEntity.value = null;
};

const handleUpdate = () => {
  // Trigger any necessary engine updates if needed, though most properties are reactive via shared objects
};

watch(() => props.initialLevelName, (newName) => {
  levelName.value = newName;
});
</script>

<template>
  <div class="h-screen w-screen bg-black text-white overflow-hidden flex flex-col relative">
    <!-- Overlay Layer -->
    <div class="absolute inset-0 pointer-events-none z-10 flex flex-col">
      <TopMenu 
        class="pointer-events-auto"
        v-model:level-name="levelName"
        v-model:is-paused="isPaused"
        :engine="engine"
      />
      
      <div class="flex-1 relative">
        <ObjectList 
          class="absolute left-4 top-4 bottom-4 w-64 bg-black/60 backdrop-blur-md rounded-xl border border-white/10 overflow-y-auto pointer-events-auto shadow-2xl"
          :selected-entity="selectedEntity" 
          @select="selectedEntity = $event" 
        />
        
        <ObjectProperties 
          v-if="selectedEntity"
          class="absolute right-4 top-4 bottom-4 w-72 bg-black/60 backdrop-blur-md rounded-xl border border-white/10 overflow-y-auto pointer-events-auto shadow-2xl"
          :selected-entity="selectedEntity" 
          @update="handleUpdate"
          @delete="handleDelete"
        />

        <div class="absolute bottom-8 left-1/2 -translate-x-1/2 pointer-events-auto">
          <Toolbar 
            v-model:tool="tool" 
            v-model:placement="placement" 
          />
        </div>

        <div class="absolute top-4 left-72 text-xs font-mono opacity-40 pointer-events-none bg-black/40 px-2 py-1 rounded">
          FPS: {{ fps }} | ROPE: {{ ropeState ? `${ropeState.mode} (${ropeState.segments})` : 'OFF' }}
        </div>
      </div>
    </div>

    <!-- Canvas Layer -->
    <div ref="canvasRef" class="absolute inset-0 z-0" />
  </div>
</template>