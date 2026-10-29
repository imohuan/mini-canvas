<script setup lang="ts">
import { dismiss, notifyList } from './store'
import './notify.css'

defineOptions({ name: 'MckNotifyHost' })

interface NotifyItemLike {
  id: string
  action?: { label: string; onClick: () => void }
}

function handleAction(item: NotifyItemLike): void {
  item.action?.onClick()
  dismiss(item.id)
}
</script>

<template>
  <Teleport to="body">
    <div class="mck-notify-host" aria-live="polite" aria-atomic="false">
      <TransitionGroup name="mck-notify">
        <div v-for="item in notifyList" :key="item.id" class="mck-notify" :class="'is-' + (item.tone ?? 'info')" role="status">
          <span class="mck-notify__dot" aria-hidden="true"></span>
          <div class="mck-notify__copy">
            <strong class="mck-notify__title">{{ item.title }}</strong>
            <p v-if="item.description" class="mck-notify__desc">{{ item.description }}</p>
            <button v-if="item.action" type="button" class="mck-notify__action" @click="handleAction(item)">{{ item.action.label }}</button>
          </div>
          <button type="button" class="mck-notify__close" aria-label="关闭通知" title="关闭" @click="dismiss(item.id)">×</button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
