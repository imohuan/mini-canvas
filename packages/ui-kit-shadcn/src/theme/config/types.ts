/** 配置条里各小件共用的类型（<script setup> 不能 export 类型，单独放这里）。 */

export interface ChoiceOption {
  value: string
  label: string
  /** 预览方块（圆角用 borderRadius，尺寸用 height） */
  paint: string
  /** 预览方块类型：'radius' 画边框方块，'size' 画一条横杠 */
  kind: 'radius' | 'size'
  title?: string
}
