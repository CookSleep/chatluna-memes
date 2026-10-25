<template>
  <label class="ml-number" :class="{ 'is-invalid': !!error, 'is-wide': wide }" :title="error">
    <input
      type="number"
      inputmode="decimal"
      :value="Number.isFinite(modelValue) ? modelValue : ''"
      :min="min"
      :max="max"
      :step="step"
      :aria-label="label"
      :aria-invalid="!!error"
      @input="onInput"
    />
    <span v-if="unit">{{ unit }}</span>
  </label>
</template>
<script lang="ts">
import { defineComponent } from 'vue'

/** 带单位的数字输入框；清空时输出 NaN，由上层显示「请填写数字」。 */
export default defineComponent({
  name: 'SettingNumber',
  props: {
    modelValue: { type: Number, required: true },
    unit: { type: String, default: '' },
    label: { type: String, default: '' },
    min: { type: Number, default: undefined },
    max: { type: Number, default: undefined },
    step: { type: Number, default: 1 },
    error: { type: String, default: '' },
    wide: { type: Boolean, default: false },
  },
  emits: ['update:modelValue'],
  setup(_, { emit }) {
    function onInput(event: Event) {
      const raw = (event.target as HTMLInputElement).value
      emit('update:modelValue', raw === '' ? Number.NaN : Number(raw))
    }
    return { onInput }
  },
})
</script>
