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
  <div class="h-screen flex flex-col bg-black text-white overflow-hidden">
    <!-- Top Menu -->
    <TopMenu 
      v-model:level-name="levelName"
      v-model:is-paused="isPaused"
      :engine="engine"
    />

    <div class="flex-1 relative">
        <ObjectList 
          class="absolute left-0 top-0 bottom-0 w-64 bg-gray-900/50 backdrop-blur-md overflow-y-auto z-10 border-r border-white/10"
          :selected-entity="selectedEntity" 
          @select="selectedEntity = $event" 
        />
        
        <ObjectProperties 
          v-if="selectedEntity"
          class="absolute right-0 top-0 bottom-0 w-72 bg-gray-900/50 backdrop-blur-md overflow-y-auto z-10 border-l border-white/10"
          :selected-entity="selectedEntity" 
          @update="handleUpdate"
          @delete="handleDelete"
        />

      <!-- Main Canvas Area -->
      <div class="absolute inset-0">
        <div ref="canvasRef" class="w-full h-full" />
        <span class="absolute top-4 left-4 text-xs font-mono opacity-50 pointer-events-none">FPS: <span>{{ fps }}</span></span>

        <!-- Rope Status Overlay -->
        <div v-if="ropeState">
          <div>
            <div />
            <span>Mode: <span>{{ ropeState.mode }}</span></span>
            <div />
            <span>Segments: <span>{{ ropeState.segments }} / 100</span></span>
          </div>
        </div>

        <!-- FPS Overlay (when not building rope) -->
        <div 
          v-else
          class="absolute top-4 left-4 text-xs font-mono opacity-50 pointer-events-none"
        >
          {{ fps }} FPS
        </div>

        <div class="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
          <Toolbar 
            v-model:tool="tool" 
            v-model:placement="placement" 
          />
        </div>
      </div>
    </div>
  </div>
</template>