<script setup lang="ts">
import { type Entity } from '@/ecs';
import { computed } from 'vue';

const props = defineProps<{
  selectedEntity: Entity;
}>();

const emit = defineEmits<{
  (e: 'update'): void;
  (e: 'delete', entity: Entity): void;
}>();

const body = computed(() => props.selectedEntity.physicsBody || props.selectedEntity.staticBody);

const update = () => {
  emit('update');
};

const radToDeg = (rad: number) => Math.round(rad * (180 / Math.PI));
const degToRad = (deg: number) => deg * (Math.PI / 180);

const rotationDeg = computed({
  get: () => props.selectedEntity.transform ? radToDeg(props.selectedEntity.transform.rotation) : 0,
  set: (val: number) => {
    if (props.selectedEntity.transform) {
      props.selectedEntity.transform.rotation = degToRad(val);
      update();
    }
  }
});
</script>

<template>
  <div>
    <div>
      Properties
    </div>

    <div>
      <!-- General -->
      <UFormGroup label="Name" size="xs">
        <UInput 
          v-model="selectedEntity.name" 
          @update:model-value="update"
          size="xs"
          autocomplete="off"
        />
      </UFormGroup>

      <!-- Transform -->
      <div v-if="selectedEntity.transform">
        <div>Transform</div>
        
        <UFormGroup label="Position" size="xs">
          <div>
            <UInput 
              type="number" 
              step="0.1" 
              v-model.number="selectedEntity.transform.position[0]" 
              @update:model-value="update"
              size="xs"
             
              placeholder="X"
            >
              <template #leading>
                <span>X</span>
              </template>
            </UInput>
            <UInput 
              type="number" 
              step="0.1" 
              v-model.number="selectedEntity.transform.position[1]" 
              @update:model-value="update"
              size="xs"
             
              placeholder="Y"
            >
              <template #leading>
                <span>Y</span>
              </template>
            </UInput>
          </div>
        </UFormGroup>

        <UFormGroup label="Rotation" size="xs">
          <UInput 
            type="number" 
            v-model.number="rotationDeg" 
            size="xs"
          >
            <template #trailing>
              <span>°</span>
            </template>
          </UInput>
        </UFormGroup>
      </div>

      <!-- Constraint -->
      <div v-if="selectedEntity.physicsConstraint">
        <div>Constraint</div>
        
        <UFormGroup label="Rest Value" size="xs">
          <UInput 
            type="number" 
            step="0.01" 
            v-model.number="selectedEntity.physicsConstraint.restValue" 
            @update:model-value="selectedEntity.physicsConstraint.isDirty = true"
            size="xs"
          />
        </UFormGroup>

        <UFormGroup label="Compliance" size="xs">
          <UInput 
            type="number" 
            step="0.0001" 
            v-model.number="selectedEntity.physicsConstraint.compliance" 
            @update:model-value="selectedEntity.physicsConstraint.isDirty = true"
            size="xs"
          />
        </UFormGroup>
      </div>

      <!-- Physics -->
      <div v-if="body">
        <div>Physics</div>
        
        <UFormGroup v-if="selectedEntity.physicsBody" label="Mass" size="xs">
          <UInput 
            type="number" 
            min="0.1" 
            step="0.1" 
            v-model.number="selectedEntity.physicsBody.mass" 
            @update:model-value="update"
            size="xs"
          />
        </UFormGroup>

        <UFormGroup label="Friction" size="xs">
          <UInput 
            type="number" 
            min="0" 
            max="1" 
            step="0.05" 
            v-model.number="body.friction" 
            @update:model-value="update"
            size="xs"
          />
        </UFormGroup>
      </div>

      <!-- SDF Collider -->
      <div v-if="selectedEntity.sdfCollider">
        <div>SDF Collider</div>
        
        <UFormGroup 
          v-for="(p, i) in selectedEntity.sdfCollider.parameters" 
          :key="i" 
          :label="`Param ${i}`" 
          size="xs"
        >
          <UInput 
            type="number" 
            step="0.1" 
            v-model.number="selectedEntity.sdfCollider.parameters[i]" 
            @update:model-value="update"
            size="xs"
          />
        </UFormGroup>
      </div>

      <UDivider />

      <UButton
        @click="emit('delete', selectedEntity)"
        color="red"
        variant="soft"
        block
        icon="i-heroicons-trash"
        size="xs"
      >
        Delete Object
      </UButton>
    </div>
  </div>
</template>
