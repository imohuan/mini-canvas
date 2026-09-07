// plugin-file-drop —— 文件拖入 & 粘贴插件包统一出口
export { fileDropPlugin } from './fileDropPlugin'
export type { FileDropService, FileDropOptions, FileDropReaders } from './fileDropPlugin'
export {
  classifyFile,
  clampText,
  fitImageSize,
  spreadPositions,
  buildImagePayload,
  buildTextPayload,
  MAX_TEXT_LENGTH,
  DEFAULT_IMAGE_SIZE,
  type FileKind,
  type FileLike,
  type ImageDims,
  type NodePayload,
} from './fileDropEngine'
