<template>
  <div class="app-container">
    <div class="header">
      <h1>ProseMirror Editor 测试用例</h1>
      <p class="subtitle">支持 @ 提及变量和资源（图片/视频）</p>
    </div>

    <div class="main-content">
      <!-- 左侧：编辑器 -->
      <div class="editor-section">
        <div class="section-header">
          <h2>编辑器</h2>
          <div class="actions">
            <button @click="saveContent" class="btn-success">保存内容</button>
            <button @click="exportContent" class="btn-primary">导出文本</button>
            <button @click="clearContent" class="btn-secondary">清空</button>
          </div>
        </div>
        
        <div class="editor-wrapper">
          <ProseMirrorEditor
            ref="editorRef"
            v-model="content"
            :resources="resources"
            :variables="variables"
            @resource-insert="handleResourceInsert"
            @variable-insert="handleVariableInsert"
          />
        </div>

        <div class="output-section">
          <div class="output-box">
            <h3>当前内容（显示变量名）</h3>
            <pre>{{ content || '（空）' }}</pre>
          </div>
          
          <div class="output-box" v-if="exportedText">
            <h3>导出内容（变量已替换）</h3>
            <pre>{{ exportedText }}</pre>
          </div>

          <!-- 保存的数据预览 -->
          <div class="output-box saved-data-box" v-if="showSavedData">
            <div class="saved-data-header">
              <h3>保存的数据（JSON格式）</h3>
              <div class="saved-data-actions">
                <button @click="copySavedData" class="btn-copy">复制</button>
                <button @click="showSavedData = false" class="btn-close">关闭</button>
              </div>
            </div>
            <textarea 
              v-model="savedData" 
              class="saved-data-textarea"
              placeholder="粘贴保存的JSON数据到这里..."
            ></textarea>
            <button @click="loadContent" class="btn-load">导入数据</button>
          </div>
        </div>
      </div>

      <!-- 右侧：配置面板 -->
      <div class="config-section">
        <!-- 变量配置 -->
        <div class="config-panel">
          <div class="panel-header">
            <h3>变量配置</h3>
            <button @click="resetVariables" class="btn-reset">恢复默认</button>
          </div>
          
          <div class="config-list">
            <div v-for="(variable, index) in variables" :key="variable.id" class="config-item">
              <div class="item-header">
                <span class="item-index">{{ index + 1 }}</span>
                <button @click="removeVariable(index)" class="btn-remove">删除</button>
              </div>
              <input 
                v-model="variable.name" 
                placeholder="变量名" 
                class="input-field"
              />
              <input 
                v-model="variable.value" 
                placeholder="变量值" 
                class="input-field"
              />
            </div>
          </div>
          
          <button @click="addVariable" class="btn-add">+ 添加变量</button>
        </div>

        <!-- 资源配置 -->
        <div class="config-panel">
          <div class="panel-header">
            <h3>资源配置</h3>
            <button @click="resetResources" class="btn-reset">恢复默认</button>
          </div>
          
          <div class="config-list">
            <div v-for="(resource, index) in resources" :key="resource.id" class="config-item">
              <div class="item-header">
                <span class="item-index">{{ index + 1 }}</span>
                <button @click="removeResource(index)" class="btn-remove">删除</button>
              </div>
              <input 
                v-model="resource.name" 
                placeholder="资源名称" 
                class="input-field"
              />
              <input 
                v-model="resource.url" 
                placeholder="资源URL" 
                class="input-field"
              />
              <select v-model="resource.type" class="input-field">
                <option value="image">图片</option>
                <option value="video">视频</option>
              </select>
            </div>
          </div>
          
          <button @click="addResource" class="btn-add">+ 添加资源</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ProseMirrorEditor } from '../src/index';
import type { ResourceItem, VariableItem } from '../src/types';

const editorRef = ref<InstanceType<typeof ProseMirrorEditor> | null>(null);
const content = ref('你好，我是 ，今年 ，来自 ');
const exportedText = ref('');
const savedData = ref('');
const showSavedData = ref(false);

// 默认变量数据
const defaultVariables: VariableItem[] = [
  { id: '1', name: '用户名', value: '张三' },
  { id: '2', name: '年龄', value: '25岁' },
  { id: '3', name: '城市', value: '北京' },
  { id: '4', name: '职业', value: '软件工程师' },
  { id: '5', name: '爱好', value: '编程和阅读' },
  { id: '6', name: '邮箱', value: 'zhangsan@example.com' },
];

// 默认资源数据
const defaultResources: ResourceItem[] = [
  {
    id: '1',
    name: '示例图片1',
    url: 'https://picsum.photos/200/300',
    type: 'image',
  },
  {
    id: '2',
    name: '示例图片2',
    url: 'https://picsum.photos/300/200',
    type: 'image',
  },
  {
    id: '3',
    name: '示例图片3',
    url: 'https://picsum.photos/250/250',
    type: 'image',
  },
];

const variables = ref<VariableItem[]>(JSON.parse(JSON.stringify(defaultVariables)));
const resources = ref<ResourceItem[]>(JSON.parse(JSON.stringify(defaultResources)));

// 变量操作
function addVariable() {
  const newId = String(Date.now());
  variables.value.push({
    id: newId,
    name: '',
    value: '',
  });
}

function removeVariable(index: number) {
  variables.value.splice(index, 1);
}

function resetVariables() {
  variables.value = JSON.parse(JSON.stringify(defaultVariables));
}

// 资源操作
function addResource() {
  const newId = String(Date.now());
  resources.value.push({
    id: newId,
    name: '',
    url: '',
    type: 'image',
  });
}

function removeResource(index: number) {
  resources.value.splice(index, 1);
}

function resetResources() {
  resources.value = JSON.parse(JSON.stringify(defaultResources));
}

// 编辑器操作
function exportContent() {
  if (editorRef.value) {
    exportedText.value = editorRef.value.exportText();
  }
}

function clearContent() {
  content.value = '';
  exportedText.value = '';
}

// 保存编辑器内容（包含结构）
function saveContent() {
  if (!editorRef.value) return;
  
  const data = {
    doc: editorRef.value.serializeDoc(), // 保存完整的文档结构
    variables: variables.value,
    resources: resources.value,
    timestamp: new Date().toISOString(),
  };
  savedData.value = JSON.stringify(data, null, 2);
  showSavedData.value = true;
  console.log('已保存内容:', data);
}

// 导入编辑器内容
function loadContent() {
  if (!editorRef.value) return;
  
  try {
    const data = JSON.parse(savedData.value);
    
    // 先恢复变量和资源配置
    variables.value = data.variables || [];
    resources.value = data.resources || [];
    
    // 等待下一个 tick 后恢复文档结构
    setTimeout(() => {
      if (editorRef.value && data.doc) {
        editorRef.value.deserializeDoc(data.doc);
      }
      exportedText.value = '';
      console.log('已导入内容:', data);
    }, 100);
  } catch (error) {
    alert('导入失败：数据格式错误');
    console.error('导入错误:', error);
  }
}

// 复制保存的数据
function copySavedData() {
  navigator.clipboard.writeText(savedData.value).then(() => {
    alert('已复制到剪贴板');
  });
}

function handleResourceInsert(resource: ResourceItem) {
  console.log('插入资源:', resource);
}

function handleVariableInsert(variable: VariableItem) {
  console.log('插入变量:', variable);
}
</script>

<style scoped>
.app-container {
  min-height: 100vh;
  background: #f9fafb;
  padding: 20px;
}

.header {
  text-align: center;
  margin-bottom: 30px;
}

.header h1 {
  font-size: 28px;
  color: #111;
  margin-bottom: 8px;
}

.subtitle {
  color: #6b7280;
  font-size: 14px;
}

.main-content {
  display: grid;
  grid-template-columns: 1fr 400px;
  gap: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

/* 编辑器区域 */
.editor-section {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.section-header h2 {
  font-size: 20px;
  color: #111;
}

.actions {
  display: flex;
  gap: 8px;
}

.editor-wrapper {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
  min-height: 200px;
  margin-bottom: 20px;
  max-height: 400px;
  overflow: auto;
}

.output-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.output-box {
  background: #f9fafb;
  border-radius: 8px;
  padding: 16px;
}

.output-box h3 {
  font-size: 14px;
  color: #6b7280;
  margin-bottom: 8px;
}

.output-box pre {
  background: white;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.6;
  color: #111;
  border: 1px solid #e5e7eb;
}

/* 配置区域 */
.config-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.config-panel {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.panel-header h3 {
  font-size: 16px;
  color: #111;
}

.config-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 12px;
  max-height: 400px;
  overflow-y: auto;
}

.config-item {
  background: #f9fafb;
  border-radius: 8px;
  padding: 12px;
  border: 1px solid #e5e7eb;
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.item-index {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
}

.input-field {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  margin-bottom: 8px;
  transition: border-color 0.2s;
}

.input-field:focus {
  outline: none;
  border-color: #2563eb;
}

.input-field:last-child {
  margin-bottom: 0;
}

/* 按钮样式 */
.btn-primary {
  padding: 8px 16px;
  background: #2563eb;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background 0.2s;
}

.btn-primary:hover {
  background: #1d4ed8;
}

.btn-secondary {
  padding: 8px 16px;
  background: #6b7280;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background 0.2s;
}

.btn-secondary:hover {
  background: #4b5563;
}

.btn-reset {
  padding: 6px 12px;
  background: #f3f4f6;
  color: #374151;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.btn-reset:hover {
  background: #e5e7eb;
}

.btn-remove {
  padding: 4px 8px;
  background: #fee2e2;
  color: #dc2626;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.2s;
}

.btn-remove:hover {
  background: #fecaca;
}

.btn-add {
  width: 100%;
  padding: 10px;
  background: #f3f4f6;
  color: #374151;
  border: 1px dashed #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
}

.btn-add:hover {
  background: #e5e7eb;
  border-color: #9ca3af;
}

.btn-success {
  padding: 8px 16px;
  background: #10b981;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background 0.2s;
}

.btn-success:hover {
  background: #059669;
}

.btn-copy {
  padding: 4px 12px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.2s;
}

.btn-copy:hover {
  background: #2563eb;
}

.btn-close {
  padding: 4px 12px;
  background: #6b7280;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.2s;
}

.btn-close:hover {
  background: #4b5563;
}

.btn-load {
  width: 100%;
  padding: 10px;
  background: #2563eb;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  margin-top: 12px;
  transition: background 0.2s;
}

.btn-load:hover {
  background: #1d4ed8;
}

/* 保存数据区域 */
.saved-data-box {
  background: #f0f9ff;
  border: 2px solid #3b82f6;
}

.saved-data-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.saved-data-header h3 {
  margin: 0;
}

.saved-data-actions {
  display: flex;
  gap: 8px;
}

.saved-data-textarea {
  width: 100%;
  min-height: 200px;
  padding: 12px;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.6;
  resize: vertical;
  background: white;
}

.saved-data-textarea:focus {
  outline: none;
  border-color: #3b82f6;
}

/* 响应式 */
@media (max-width: 1024px) {
  .main-content {
    grid-template-columns: 1fr;
  }
  
  .config-section {
    flex-direction: row;
  }
}

@media (max-width: 768px) {
  .config-section {
    flex-direction: column;
  }
}
</style>
