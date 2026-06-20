export type ArrangeDirection = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

export interface AlignArrangeConfig {
  gap: number
  debug: boolean
}

export interface AlignArrangeAPI {
  arrange(direction: ArrangeDirection): void
  setGap(gap: number): void
  getConfig(): AlignArrangeConfig
}
