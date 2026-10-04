// plugin-cloud-client —— 统一出口
//
// 1. 插件本体：宿主 / 外部 js 装配用（export 的 name / inject / Config / apply）
// 2. 纯函数与适配器：供"在别处复用这套云端读写"（比如自己写一个只上传不恢复的插件）
export { cloudClientPlugin, name, inject, Config, apply } from './plugin.js'
export { migrateLocalResources } from './plugin.js'
export type { GenHistoryService, CloudClientService, CloudClientStatus } from './plugin.js'

export { CloudApi } from './api.js'
export type { CloudApiOptions, FetchLike, EventSourceLike, ChangeEvent } from './apiTypes.js'
export type {
  ServerAction,
  ServerJob,
  ServerHistoryEntry,
  ServerHistoryPage,
  HistoryQueryInput,
} from './apiTypes.js'

export { toBarAction, diffActions, groupByNodeType, staleActionIds } from './actions.js'
export type { BarActionLike } from './actions.js'

export { CanvasDiffAdapter } from './canvasDiffAdapter.js'
export { diffGraph, isEmptyOps } from './graphDiff.js'
export type { GraphOps } from './graphDiff.js'

export { createRemoteSync, toSnapshot } from './remoteSync.js'
export type { RemoteSync, RemoteSyncOptions, LocalGraphHandlers } from './remoteSync.js'
export { planRemoteMerge, isPlanEmpty } from './remoteMerge.js'
export type { CanvasGraphSnapshot, MergeNode, MergeEdge, RemoteMergePlan } from './remoteMerge.js'

export {
  isResourceRef,
  parseResourceRef,
  resolveRef,
  toRef,
  expandNodes,
  shrinkNodes,
  pendingUploadFields,
} from './resourceRef.js'

export { makeJobPoll, submitJob, toPollState } from './jobRunner.js'
export type { PollState, RunDeps, ResourceLike } from './jobRunner.js'

export { restoreOrSeed } from './restore.js'
export type { RestoreDeps, RestoreResult } from './restore.js'

export { applyMergePlan, diffDataKeys, isRuntimeOnly } from './applyMerge.js'
export type { DocLike, MergePlanLike } from './applyMerge.js'

export { writeVideoResult, writeAudioResult } from './appliers.js'
export type { DocLike as ApplierDoc, ToolResultLike } from './appliers.js'

export { configFrom } from './config.js'
export type { CloudClientConfig, SettingsLike } from './config.js'

export {
  GRAPH_KEY,
  GRAPH_EDGES_KEY,
  GRAPH_VIEWPORT_KEY,
  PROVIDERS_VERSION_KEY,
  HISTORY_REV_KEY,
  CANVAS_ID,
  RESOURCE_REF_PREFIX,
  RESOURCE_URL_FIELDS,
} from './keys.js'
