<script setup lang="ts">
import { messageList } from './store'
import './messages.css'

defineOptions({ name: 'MckMessagesHost' })
</script>

<template>
  <Teleport to="body">
    <div class="mck-messages-host" aria-live="polite">
      <TransitionGroup name="mck-message">
        <div v-for="item in messageList" :key="item.id" class="mck-message" :class="'is-' + (item.tone ?? 'neutral')" role="status">
          {{ item.text }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
