<template>
  <k-layout main="cm-page" class="cm-theme chatluna-memes-app-layout">
    <template #header>
      <AppHeader />
    </template>

    <div class="cm-progress" :class="{ 'is-active': loading && initialized }"></div>
    <el-scrollbar class="cm-scroll">
      <div class="cm-container">
        <LoadingSpinner v-if="!initialized" />
        <template v-else>
          <MenuSwitcher v-if="!currentCollection" />
          <ConfigView v-if="activeMenu === 'config'" />
          <CollectionsView v-else-if="activeMenu === 'resources'" />
          <EndpointsView v-else-if="activeMenu === 'distribution'" />
          <StagingView v-else-if="activeMenu === 'staging'" />
          <PreviewView v-else-if="activeMenu === 'preview'" />
        </template>
      </div>
    </el-scrollbar>
    <Toast />
    <AppDialog />
  </k-layout>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useDashboardContext } from '../../composables/dashboardContext'
import AppHeader from './AppHeader.vue'
import MenuSwitcher from './MenuSwitcher.vue'
import Toast from '../shared/Toast.vue'
import AppDialog from '../shared/AppDialog.vue'
import LoadingSpinner from '../shared/LoadingSpinner.vue'
import CollectionsView from '../views/collections/CollectionsView.vue'
import EndpointsView from '../views/endpoints/EndpointsView.vue'
import StagingView from '../views/staging/StagingView.vue'
import PreviewView from '../views/preview/PreviewView.vue'
import ConfigView from '../views/config/ConfigView.vue'

export default defineComponent({
  name: 'AppLayout',
  components: {
    AppHeader,
    MenuSwitcher,
    Toast,
    AppDialog,
    LoadingSpinner,
    CollectionsView,
    EndpointsView,
    StagingView,
    PreviewView,
    ConfigView,
  },
  setup() {
    return useDashboardContext()
  },
})
</script>
