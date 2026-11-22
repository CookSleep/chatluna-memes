<template><div ref="container"></div></template>
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watchEffect } from 'vue'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SelectControl, type SelectOption } from './SelectControl'
import '../../styles/select.css'

const props = defineProps<{
  modelValue: string
  label: string
  options: SelectOption[]
  searchable?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const container = ref<HTMLDivElement>()
let root: Root | undefined

onMounted(() => {
  root = createRoot(container.value!)
  watchEffect(() => root?.render(createElement(SelectControl, {
    value: props.modelValue,
    label: props.label,
    options: props.options,
    searchable: props.searchable,
    disabled: props.disabled,
    onChange: (value) => emit('update:modelValue', value),
  })))
})

onBeforeUnmount(() => queueMicrotask(() => root?.unmount()))
</script>
