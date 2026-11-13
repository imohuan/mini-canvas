import { defineComponent, h, type Component } from 'vue'

/**
 * 本插件测试用的 ui 目录替身。
 *
 * 多选只按名取两个渲染件：movingHandle / connectionLine。
 * 形状与主题同名同标记，用来锁「调的是同一个名字、传的是同一套几何」；
 * 真实端口的外观与跟随动效归主题包自己的测试。
 */

/** 节点端口：锚点 / 跟随区 / 按钮三层，zoneHeight 决定跟随区高度 */
const MovingHandle = defineComponent({
  name: 'TestMovingHandle',
  inheritAttrs: false,
  props: {
    preview: { type: Boolean, default: false },
    visible: { type: Boolean, default: true },
    zoneHeight: { type: [Number, String], default: undefined },
  },
  setup(props, { attrs, slots }) {
    return () => {
      if (!props.visible) return null
      const rest = { ...attrs } as Record<string, unknown>
      const cls = ['moving-handle-anchor', props.preview ? 'is-preview' : '', rest.class]
        .filter(Boolean)
        .join(' ')
      delete rest.class
      return h('div', { class: cls, ...rest }, [
        h(
          'div',
          {
            class: 'port-follow-zone port-follow-zone--target',
            style:
              props.zoneHeight == null
                ? undefined
                : { height: typeof props.zoneHeight === 'number' ? props.zoneHeight + 'px' : props.zoneHeight },
          },
          [h('div', { class: 'moving-handle-button' }, slots.default?.())],
        ),
      ])
    }
  },
})

/** 拖线临时线 */
const ConnectionLine = defineComponent({
  name: 'TestConnectionLine',
  inheritAttrs: false,
  setup(_props, { attrs }) {
    return () => h('path', { class: 'connection-line-stub', ...attrs })
  },
})

/** 按钮（批量工具栏用） */
const Button = defineComponent({
  name: 'TestButton',
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () => h('button', { type: 'button', ...attrs }, slots.default?.())
  },
})

export const UI_STUBS: Record<string, Component> = {
  movingHandle: MovingHandle,
  connectionLine: ConnectionLine,
  Button,
}

