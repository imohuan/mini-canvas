<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AxButton,
  AxDropdown,
  AxSelect,
  AxSwitch,
  AxSlider,
} from '../canvas/core/components/Ui'
import type { SelectOption } from '../canvas/core/components/Ui/types'

const router = useRouter()

// ── Button demo state ──
const btnLoading = ref(false)
const btnClickCount = ref(0)
const handleBtnClick = () => { btnClickCount.value++ }
const handleToggleLoading = () => {
  btnLoading.value = !btnLoading.value
  if (btnLoading.value) setTimeout(() => { btnLoading.value = false }, 2000)
}

// ── Switch demo state ──
const switch1 = ref(false)
const switch2 = ref(true)
const switch3 = ref(false)

// ── Slider demo state ──
const sliderVal = ref(50)
const sliderVal2 = ref(30)
const sliderVal3 = ref(400)

// ── Select demo state ──
const selectVal = ref<string | number>('')
const selectOptions: SelectOption[] = [
  { value: 'cyan', label: 'Cyan #0891b2' },
  { value: 'red', label: 'Red #ef4444' },
  { value: 'blue', label: 'Blue #3b82f6' },
  { value: 'green', label: 'Green #10b981' },
  { value: 'amber', label: 'Amber #f59e0b' },
  { value: 'purple', label: 'Purple #8b5cf6' },
  { value: 'disabled-opt', label: 'Disabled Option', disabled: true },
]

// ── Dropdown demo state ──
const menuActionLog = ref<string[]>([])
const addMenuLog = (action: string) => {
  menuActionLog.value.unshift(`[${new Date().toLocaleTimeString()}] ${action}`)
  if (menuActionLog.value.length > 5) menuActionLog.value.pop()
}
</script>

<template>
  <div class="min-h-screen bg-surface font-sans text-on-surface font-label-md">
    <!-- Header -->
    <header class="sticky top-0 z-[9999] flex items-center gap-ax-sm px-6 py-3.5 bg-surface-container-lowest/90 backdrop-blur-md border-b border-outline-variant">
      <button
        class="inline-flex items-center gap-1 px-2.5 py-1.5 pl-1.5 border border-outline-variant rounded-lg bg-surface-container-lowest text-on-surface text-[13px] font-semibold cursor-pointer hover:bg-surface-container transition-colors"
        @click="router.push('/')"
      >
        <span class="material-symbols-outlined text-[18px]">arrow_back</span>
      </button>
      <h1 class="text-lg font-bold m-0">Ax UI Components</h1>
      <span class="text-[12px] font-semibold text-secondary px-1.5 py-px bg-surface-container rounded">Material 3</span>
    </header>

    <main class="max-w-[960px] mx-auto px-6 py-8 pb-20">

      <!-- ==================== AxButton ==================== -->
      <section class="mb-12">
        <h2 class="text-xl font-bold mb-5 pb-2 border-b-2 border-outline-variant">AxButton</h2>

        <div class="mb-6">
          <h3 class="text-[13px] font-semibold text-secondary mb-2.5">Variants</h3>
          <div class="flex items-center gap-2.5 flex-wrap">
            <AxButton variant="primary">Primary</AxButton>
            <AxButton variant="outline">Outline</AxButton>
            <AxButton variant="ghost">Ghost</AxButton>
            <AxButton variant="danger">Danger</AxButton>
          </div>
        </div>

        <div class="mb-6">
          <h3 class="text-[13px] font-semibold text-secondary mb-2.5">Sizes</h3>
          <div class="flex items-center gap-2.5 flex-wrap">
            <AxButton variant="outline" size="xs">XS</AxButton>
            <AxButton variant="outline" size="sm">SM</AxButton>
            <AxButton variant="outline" size="md">MD</AxButton>
            <AxButton variant="outline" size="lg">LG</AxButton>
            <AxButton variant="outline" size="xl">XL</AxButton>
          </div>
        </div>

        <div class="mb-6">
          <h3 class="text-[13px] font-semibold text-secondary mb-2.5">With Material Icons</h3>
          <div class="flex items-center gap-2.5 flex-wrap">
            <AxButton variant="primary" icon="add">New Item</AxButton>
            <AxButton variant="outline" icon="check">Confirm</AxButton>
            <AxButton variant="danger" icon="delete">Delete</AxButton>
            <AxButton variant="ghost" icon="settings" />
          </div>
        </div>

        <div class="mb-6">
          <h3 class="text-[13px] font-semibold text-secondary mb-2.5">Loading &amp; Disabled</h3>
          <div class="flex items-center gap-2.5 flex-wrap">
            <AxButton variant="primary" :loading="btnLoading" @click="handleToggleLoading">
              {{ btnLoading ? 'Processing...' : 'Click to Load' }}
            </AxButton>
            <AxButton variant="outline" disabled>Disabled</AxButton>
          </div>
          <div class="mt-2.5">
            <AxButton variant="primary" block>Block Width Button</AxButton>
          </div>
        </div>

        <div class="mb-6">
          <h3 class="text-[13px] font-semibold text-secondary mb-2.5">
            Ripple &amp; Click Count:
            <span class="inline-block text-[12px] font-bold text-primary px-1.5 py-px bg-primary-container rounded tabular-nums">{{ btnClickCount }}</span>
          </h3>
          <div class="flex items-center gap-2.5 flex-wrap">
            <AxButton variant="primary" @click="handleBtnClick">Click Me</AxButton>
            <AxButton variant="outline" @click="handleBtnClick">Click Me</AxButton>
            <AxButton variant="ghost" @click="handleBtnClick">Click Me</AxButton>
          </div>
        </div>
      </section>

      <!-- ==================== AxSwitch ==================== -->
      <section class="mb-12">
        <h2 class="text-xl font-bold mb-5 pb-2 border-b-2 border-outline-variant">AxSwitch</h2>

        <div class="mb-6">
          <h3 class="text-[13px] font-semibold text-secondary mb-2.5">Sizes</h3>
          <div class="flex items-center gap-ax-sm flex-wrap">
            <label class="flex items-center gap-2 cursor-pointer text-[13px] font-semibold text-on-surface select-none">
              <span>XS</span><AxSwitch v-model="switch1" size="xs" />
            </label>
            <label class="flex items-center gap-2 cursor-pointer text-[13px] font-semibold text-on-surface select-none">
              <span>SM</span><AxSwitch v-model="switch2" size="sm" />
            </label>
            <label class="flex items-center gap-2 cursor-pointer text-[13px] font-semibold text-on-surface select-none">
              <span>MD</span><AxSwitch v-model="switch3" size="md" />
            </label>
            <label class="flex items-center gap-2 cursor-pointer text-[13px] font-semibold text-on-surface select-none">
              <span>LG</span><AxSwitch :model-value="true" size="lg" />
            </label>
            <label class="flex items-center gap-2 cursor-pointer text-[13px] font-semibold text-on-surface select-none">
              <span>XL</span><AxSwitch :model-value="true" size="xl" />
            </label>
          </div>
          <p class="text-[12px] text-secondary mt-2">State: {{ switch1 ? 'ON' : 'OFF' }} / {{ switch2 ? 'ON' : 'OFF' }} / {{ switch3 ? 'ON' : 'OFF' }}</p>
        </div>

        <div class="mb-6">
          <h3 class="text-[13px] font-semibold text-secondary mb-2.5">Disabled</h3>
          <div class="flex items-center gap-ax-sm flex-wrap">
            <label class="flex items-center gap-2 text-[13px] font-semibold text-on-surface select-none">
              <span>On</span><AxSwitch :model-value="true" disabled />
            </label>
            <label class="flex items-center gap-2 text-[13px] font-semibold text-on-surface select-none">
              <span>Off</span><AxSwitch :model-value="false" disabled />
            </label>
          </div>
        </div>
      </section>

      <!-- ==================== AxSlider ==================== -->
      <section class="mb-12">
        <h2 class="text-xl font-bold mb-5 pb-2 border-b-2 border-outline-variant">AxSlider</h2>

        <div class="mb-6">
          <h3 class="text-[13px] font-semibold text-secondary mb-2.5">Basic — Value: {{ sliderVal }}</h3>
          <div class="w-full max-w-[400px]">
            <AxSlider v-model="sliderVal" :min="0" :max="100" show-labels label-left="0" label-right="100" show-value />
          </div>
        </div>

        <div class="mb-6">
          <h3 class="text-[13px] font-semibold text-secondary mb-2.5">labelPosition="right" — Value: {{ sliderVal2 }}</h3>
          <div class="w-full max-w-[400px]">
            <AxSlider v-model="sliderVal2" :min="5" :max="95" label-position="right" show-value />
          </div>
        </div>

        <div class="mb-6">
          <h3 class="text-[13px] font-semibold text-secondary mb-2.5">Large Range — Value: {{ sliderVal3 }}</h3>
          <div class="w-full max-w-[400px]">
            <AxSlider v-model="sliderVal3" :min="100" :max="1000" show-labels label-left="100" label-right="1000" show-value value-label="¥ 400" />
          </div>
        </div>

        <div class="mb-6">
          <h3 class="text-[13px] font-semibold text-secondary mb-2.5">Disabled</h3>
          <div class="w-full max-w-[400px]">
            <AxSlider :model-value="60" disabled show-value />
          </div>
        </div>
      </section>

      <!-- ==================== AxSelect ==================== -->
      <section class="mb-12">
        <h2 class="text-xl font-bold mb-5 pb-2 border-b-2 border-outline-variant">AxSelect</h2>

        <div class="mb-6">
          <h3 class="text-[13px] font-semibold text-secondary mb-2.5">Basic — Selected: {{ selectVal || 'none' }}</h3>
          <div class="w-[300px]">
            <AxSelect v-model="selectVal" :options="selectOptions" placeholder="Pick a color..." />
          </div>
        </div>

        <div class="mb-6">
          <h3 class="text-[13px] font-semibold text-secondary mb-2.5">Searchable</h3>
          <div class="w-[300px]">
            <AxSelect v-model="selectVal" :options="selectOptions" placeholder="Pick a color..." searchable />
          </div>
        </div>

        <div class="mb-6">
          <h3 class="text-[13px] font-semibold text-secondary mb-2.5">Sizes</h3>
          <div class="flex items-center gap-2" style="width:700px">
            <AxSelect class="flex-1" :model-value="'cyan'" :options="selectOptions" size="xs" />
            <AxSelect class="flex-1" :model-value="'cyan'" :options="selectOptions" size="sm" />
            <AxSelect class="flex-1" :model-value="'cyan'" :options="selectOptions" size="md" />
            <AxSelect class="flex-1" :model-value="'cyan'" :options="selectOptions" size="lg" />
            <AxSelect class="flex-1" :model-value="'cyan'" :options="selectOptions" size="xl" />
          </div>
        </div>
      </section>

      <!-- ==================== AxDropdown ==================== -->
      <section class="mb-12">
        <h2 class="text-xl font-bold mb-5 pb-2 border-b-2 border-outline-variant">AxDropdown</h2>

        <div class="mb-6">
          <h3 class="text-[13px] font-semibold text-secondary mb-2.5">Click Trigger</h3>
          <div class="flex items-start gap-ax-sm flex-wrap">
            <AxDropdown placement="bottom-start" :offset="6" menu-max-width="220px">
              <template #trigger="{ open, toggle }">
                <AxButton variant="outline" size="sm" icon="menu" @click="toggle">
                  Menu {{ open ? '▲' : '▼' }}
                </AxButton>
              </template>
              <template #default="{ close }">
                <div class="p-0.5">
                  <button class="flex items-center gap-2 w-full px-2.5 py-1.5 border-0 rounded-lg bg-transparent text-on-surface text-[13px] font-label-md text-left cursor-pointer hover:bg-surface-container transition-colors" @click="close(); addMenuLog('Edit')">
                    <span class="material-symbols-outlined text-[16px]">edit</span>Edit
                  </button>
                  <button class="flex items-center gap-2 w-full px-2.5 py-1.5 border-0 rounded-lg bg-transparent text-on-surface text-[13px] font-label-md text-left cursor-pointer hover:bg-surface-container transition-colors" @click="close(); addMenuLog('Copy')">
                    <span class="material-symbols-outlined text-[16px]">content_copy</span>Copy
                  </button>
                  <div class="h-px mx-2 my-1 bg-outline-variant" />
                  <button class="flex items-center gap-2 w-full px-2.5 py-1.5 border-0 rounded-lg bg-transparent text-error text-[13px] font-label-md text-left cursor-pointer hover:bg-error-container transition-colors" @click="close(); addMenuLog('Delete')">
                    <span class="material-symbols-outlined text-[16px]">delete</span>Delete
                  </button>
                </div>
              </template>
            </AxDropdown>

            <div class="ml-4 p-2.5 px-3.5 bg-surface-container border border-outline-variant rounded-xl min-w-[200px]">
              <p class="text-[12px] text-secondary mb-1">Recent actions:</p>
              <p v-for="(log, i) in menuActionLog" :key="i" class="text-[12px] text-secondary m-0.5 font-mono">{{ log }}</p>
              <p v-if="menuActionLog.length === 0" class="text-[12px] text-secondary opacity-50">No actions yet</p>
            </div>
          </div>
        </div>

        <div class="mb-6">
          <h3 class="text-[13px] font-semibold text-secondary mb-2.5">Multiple Placements</h3>
          <div class="flex items-center gap-2 flex-wrap">
            <AxDropdown placement="bottom-start" :offset="4" menu-width="140px">
              <template #trigger="{ toggle }">
                <AxButton variant="ghost" size="sm" @click="toggle">↓ Start</AxButton>
              </template>
              <template #default="{ close }">
                <div class="p-0.5">
                  <button class="flex items-center gap-2 w-full px-2.5 py-1.5 border-0 rounded-lg bg-transparent text-on-surface text-[13px] font-label-md text-left cursor-pointer hover:bg-surface-container transition-colors" @click="close()">Option A</button>
                  <button class="flex items-center gap-2 w-full px-2.5 py-1.5 border-0 rounded-lg bg-transparent text-on-surface text-[13px] font-label-md text-left cursor-pointer hover:bg-surface-container transition-colors" @click="close()">Option B</button>
                  <button class="flex items-center gap-2 w-full px-2.5 py-1.5 border-0 rounded-lg bg-transparent text-on-surface text-[13px] font-label-md text-left cursor-pointer hover:bg-surface-container transition-colors" @click="close()">Option C</button>
                </div>
              </template>
            </AxDropdown>

            <AxDropdown placement="top-start" :offset="4" menu-width="140px">
              <template #trigger="{ toggle }">
                <AxButton variant="ghost" size="sm" @click="toggle">↑ Start</AxButton>
              </template>
              <template #default="{ close }">
                <div class="p-0.5">
                  <button class="flex items-center gap-2 w-full px-2.5 py-1.5 border-0 rounded-lg bg-transparent text-on-surface text-[13px] font-label-md text-left cursor-pointer hover:bg-surface-container transition-colors" @click="close()">Option A</button>
                  <button class="flex items-center gap-2 w-full px-2.5 py-1.5 border-0 rounded-lg bg-transparent text-on-surface text-[13px] font-label-md text-left cursor-pointer hover:bg-surface-container transition-colors" @click="close()">Option B</button>
                  <button class="flex items-center gap-2 w-full px-2.5 py-1.5 border-0 rounded-lg bg-transparent text-on-surface text-[13px] font-label-md text-left cursor-pointer hover:bg-surface-container transition-colors" @click="close()">Option C</button>
                </div>
              </template>
            </AxDropdown>

            <AxDropdown placement="bottom-end" :offset="4" menu-width="140px">
              <template #trigger="{ toggle }">
                <AxButton variant="ghost" size="sm" @click="toggle">↓ End</AxButton>
              </template>
              <template #default="{ close }">
                <div class="p-0.5">
                  <button class="flex items-center gap-2 w-full px-2.5 py-1.5 border-0 rounded-lg bg-transparent text-on-surface text-[13px] font-label-md text-left cursor-pointer hover:bg-surface-container transition-colors" @click="close()">Option A</button>
                  <button class="flex items-center gap-2 w-full px-2.5 py-1.5 border-0 rounded-lg bg-transparent text-on-surface text-[13px] font-label-md text-left cursor-pointer hover:bg-surface-container transition-colors" @click="close()">Option B</button>
                  <button class="flex items-center gap-2 w-full px-2.5 py-1.5 border-0 rounded-lg bg-transparent text-on-surface text-[13px] font-label-md text-left cursor-pointer hover:bg-surface-container transition-colors" @click="close()">Option C</button>
                </div>
              </template>
            </AxDropdown>

            <AxDropdown placement="right-start" :offset="4" menu-width="140px">
              <template #trigger="{ toggle }">
                <AxButton variant="ghost" size="sm" @click="toggle">→ Start</AxButton>
              </template>
              <template #default="{ close }">
                <div class="p-0.5">
                  <button class="flex items-center gap-2 w-full px-2.5 py-1.5 border-0 rounded-lg bg-transparent text-on-surface text-[13px] font-label-md text-left cursor-pointer hover:bg-surface-container transition-colors" @click="close()">Option A</button>
                  <button class="flex items-center gap-2 w-full px-2.5 py-1.5 border-0 rounded-lg bg-transparent text-on-surface text-[13px] font-label-md text-left cursor-pointer hover:bg-surface-container transition-colors" @click="close()">Option B</button>
                  <button class="flex items-center gap-2 w-full px-2.5 py-1.5 border-0 rounded-lg bg-transparent text-on-surface text-[13px] font-label-md text-left cursor-pointer hover:bg-surface-container transition-colors" @click="close()">Option C</button>
                </div>
              </template>
            </AxDropdown>
          </div>
        </div>

        <div class="mb-6">
          <h3 class="text-[13px] font-semibold text-secondary mb-2.5">Hover Trigger</h3>
          <div class="flex items-center gap-2.5 flex-wrap">
            <AxDropdown trigger="hover" placement="bottom-start" :hover-close-delay="200">
              <template #trigger="{ open }">
                <AxButton variant="outline" size="sm">Hover Me {{ open ? '(open)' : '' }}</AxButton>
              </template>
              <template #default>
                <div class="p-0.5">
                  <button class="flex items-center gap-2 w-full px-2.5 py-1.5 border-0 rounded-lg bg-transparent text-on-surface text-[13px] font-label-md text-left cursor-pointer hover:bg-surface-container transition-colors">Quick Action 1</button>
                  <button class="flex items-center gap-2 w-full px-2.5 py-1.5 border-0 rounded-lg bg-transparent text-on-surface text-[13px] font-label-md text-left cursor-pointer hover:bg-surface-container transition-colors">Quick Action 2</button>
                  <button class="flex items-center gap-2 w-full px-2.5 py-1.5 border-0 rounded-lg bg-transparent text-on-surface text-[13px] font-label-md text-left cursor-pointer hover:bg-surface-container transition-colors">Quick Action 3</button>
                </div>
              </template>
            </AxDropdown>
          </div>
        </div>
      </section>

    </main>

    <!-- Footer -->
    <footer class="py-6 text-center border-t border-outline-variant bg-surface-container-lowest">
      <p class="text-[13px] font-label-md text-secondary m-1">
        Built with Ax UI Components (Material 3) &middot;
        <a href="#" class="text-primary font-semibold no-underline hover:underline" @click.prevent="router.push('/')">Back to Canvas</a>
      </p>
      <p class="text-[11px] text-outline m-1">@floating-ui/vue &middot; Tailwind v4 &middot; Material Symbols</p>
    </footer>
  </div>
</template>

<style>
/* Override root app constraints so test page scrolls */
html, body, #app {
  margin: 0;
  padding: 0;
  min-height: 100vh;
  overflow: auto;
}
</style>
