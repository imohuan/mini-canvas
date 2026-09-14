// plugin-cloud-save —— 云端保存插件统一出口
//
// 1. 插件本体：宿主/外部 js 装配用（export 的 name/inject/Config/apply）
// 2. 纯函数与适配器：供"在别处复用这套云端读写"（比如自己写一个只上传不恢复的插件）
export { cloudSavePlugin, name, inject, Config, apply } from './cloudSavePlugin'
export type { CloudSavePluginConfig, CloudSaveService, CloudSaveStatus } from './cloudSavePlugin'

export { HttpAdapter, joinUrl } from './httpAdapter'
export type { HttpAdapterOptions } from './httpAdapter'

export {
  parseDataUrl,
  isUploadableDataUrl,
  dataUrlToBlob,
  uploadBlob,
  uploadDataUrl,
  collectUploadableFields,
  uploadFields,
  extForMime,
  RESOURCE_FIELDS,
  DEFAULT_MIN_UPLOAD_BYTES,
} from './resourceUpload'
export type { UploadedFile, UploadOptions, UploadableField, DataUrlInfo } from './resourceUpload'

export { GRAPH_KEY, GRAPH_EDGES_KEY, GRAPH_VIEWPORT_KEY } from './keys'
