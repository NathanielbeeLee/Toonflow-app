<template>
  <t-dialog v-model:visible="visible" width="78vw" top="4vh" header="导入 AI Novel 成品" :footer="false" @close="reset">
    <div v-if="!preview" class="sourcePane">
      <t-alert theme="info" message="请在 AI Novel Writing Assistant 中选择 JSON、整本书导出。预览不会写入数据；正式导入不会再次改写正文。" />
      <t-tabs v-model="sourceMode">
        <t-tab-panel value="json" label="粘贴 / JSON 文件">
          <div class="sourceForm">
            <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="readJsonFile" />
            <t-button variant="outline" @click="fileInput?.click()">选择 JSON 文件</t-button>
            <span class="muted">{{ fileName || "最大 25MB" }}</span>
            <t-textarea v-model="jsonContent" placeholder="粘贴导出的 JSON 内容" :autosize="{ minRows: 16, maxRows: 16 }" />
          </div>
        </t-tab-panel>
        <t-tab-panel value="api" label="本机 API">
          <div class="sourceForm apiForm">
            <label>API 地址</label>
            <t-input v-model="apiBaseUrl" placeholder="http://127.0.0.1:3000" />
            <label>来源项目类型</label>
            <t-radio-group v-model="apiProjectKind">
              <t-radio value="drama">成品短剧项目</t-radio>
              <t-radio value="novel">小说章节项目</t-radio>
            </t-radio-group>
            <label>{{ apiProjectKind === "drama" ? "Drama Project ID" : "Novel ID" }}</label>
            <t-input v-model="apiNovelId" placeholder="在 AI Novel 项目详情或导出地址中查看" />
            <label>可选 API Token（仅本次请求使用，不保存）</label>
            <t-input v-model="apiToken" type="password" autocomplete="off" />
            <span class="muted">默认只允许 localhost / 127.0.0.1 / ::1；远端主机必须由管理员显式加入允许列表。</span>
          </div>
        </t-tab-panel>
      </t-tabs>
      <div class="footerActions">
        <t-button @click="visible = false">取消</t-button>
        <t-button theme="primary" :loading="loading" :disabled="!canPreview" @click="loadPreview">仅校验并预览</t-button>
      </div>
    </div>

    <div v-else class="previewPane">
      <div class="summaryGrid">
        <div><strong>{{ preview.title }}</strong><span>来源作品</span></div>
        <div><strong>{{ preview.summary.importableChapters }}/{{ preview.summary.totalChapters }}</strong><span>可导入章节</span></div>
        <div><strong>{{ preview.summary.characters }}</strong><span>已识别角色</span></div>
        <div><strong>{{ selectedChapterIds.length }}</strong><span>本次选择</span></div>
      </div>
      <t-alert v-for="warning in preview.warnings" :key="warning" theme="warning" :message="warning" />
      <div v-if="preview.characters.length" class="characterLine">
        <strong>角色：</strong>
        <t-tag v-for="character in preview.characters" :key="character.externalId" variant="light-outline">
          {{ character.name }}{{ character.role ? ` / ${character.role}` : "" }}
        </t-tag>
      </div>
      <t-table
        row-key="externalId"
        :data="preview.chapters"
        :columns="columns"
        :selected-row-keys="selectedChapterIds"
        max-height="48vh"
        hover
        @select-change="onSelectChange">
        <template #contentLength="{ row }">{{ row.contentLength.toLocaleString() }} 字</template>
        <template #status="{ row }">
          <t-tag :theme="row.importable ? 'success' : 'warning'">{{ row.importable ? "可导入" : "无正文" }}</t-tag>
        </template>
        <template #plannedAction="{ row }">
          <t-tag :theme="row.plannedAction === 'create' ? 'success' : row.plannedAction === 'update' ? 'warning' : 'default'">
            {{ row.plannedAction === "create" ? "新增" : row.plannedAction === "update" ? "更新现有" : "无变化" }}
          </t-tag>
        </template>
        <template #preview="{ row }"><span class="chapterPreview">{{ row.preview || "（空）" }}</span></template>
      </t-table>
      <div class="checksum">导入器 {{ preview.importerVersion }} · 来源校验和 {{ preview.sourceChecksum.slice(0, 16) }}… · 外部版本 {{ preview.externalVersion }}</div>
      <div class="footerActions">
        <t-button variant="outline" @click="preview = null">返回修改来源</t-button>
        <t-button theme="primary" :loading="loading" :disabled="selectedChapterIds.length === 0" @click="commitImport">确认导入所选章节</t-button>
      </div>
    </div>
  </t-dialog>
</template>

<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from "tdesign-vue-next";
import axios from "@/utils/axios";
import projectStore from "@/stores/project";

interface ImportPreview {
  importerVersion: string;
  sourceChecksum: string;
  externalVersion: string;
  title: string;
  chapters: Array<{ externalId: string; order: number; title: string; contentLength: number; importable: boolean; preview: string; plannedAction: "create" | "update" | "unchanged" }>;
  characters: Array<{ externalId: string; name: string; role: string | null }>;
  summary: { totalChapters: number; importableChapters: number; emptyChapters: number; characters: number };
  warnings: string[];
}

const visible = defineModel<boolean>({ default: false });
const emit = defineEmits(["imported"]);
const { project } = storeToRefs(projectStore());
const sourceMode = ref<"json" | "api">("json");
const jsonContent = ref("");
const fileName = ref("");
const fileInput = ref<HTMLInputElement | null>(null);
const apiBaseUrl = ref("http://127.0.0.1:3000");
const apiProjectKind = ref<"novel" | "drama">("drama");
const apiNovelId = ref("");
const apiToken = ref("");
const preview = ref<ImportPreview | null>(null);
const selectedChapterIds = ref<string[]>([]);
const loading = ref(false);

const canPreview = computed(() => sourceMode.value === "json" ? jsonContent.value.trim().length > 1 : Boolean(apiBaseUrl.value.trim() && apiNovelId.value.trim()));
const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: "row-select", type: "multiple", width: 56, checkProps: ({ row }) => ({ disabled: !row.importable }) },
  { colKey: "order", title: "顺序", width: 80 },
  { colKey: "title", title: "章节 / 分集名称", width: 230, ellipsis: true },
  { colKey: "contentLength", title: "正文", width: 110 },
  { colKey: "status", title: "识别状态", width: 110 },
  { colKey: "plannedAction", title: "正式导入动作", width: 120 },
  { colKey: "preview", title: "原文预览", ellipsis: true },
];

function currentSource() {
  return sourceMode.value === "json"
    ? { mode: "json" as const, content: jsonContent.value }
    : { mode: "api" as const, baseUrl: apiBaseUrl.value.trim(), novelId: apiNovelId.value.trim(), projectKind: apiProjectKind.value, apiToken: apiToken.value || undefined };
}

async function readJsonFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) return window.$message.error("JSON 文件不能超过 25MB");
  try {
    jsonContent.value = await file.text();
    fileName.value = file.name;
  } catch {
    window.$message.error("读取 JSON 文件失败");
  }
}

async function loadPreview() {
  if (!project.value?.id) return window.$message.error("当前项目不存在");
  loading.value = true;
  try {
    const { data } = await axios.post("/script/importNovel/preview", { projectId: project.value.id, source: currentSource() });
    preview.value = data;
    selectedChapterIds.value = data.chapters.filter((chapter: any) => chapter.importable).map((chapter: any) => chapter.externalId);
  } catch (error) {
    window.$message.error((error as any)?.message || "导入预览失败");
  } finally {
    loading.value = false;
  }
}

function onSelectChange(keys: Array<string | number>) {
  selectedChapterIds.value = keys.map(String);
}

async function commitImport() {
  if (!project.value?.id) return window.$message.error("当前项目不存在");
  loading.value = true;
  try {
    const { data } = await axios.post("/script/importNovel/commit", {
      projectId: project.value.id,
      source: currentSource(),
      chapterIds: selectedChapterIds.value,
    });
    const counts = data.counts ?? { created: 0, updated: 0, unchanged: 0 };
    window.$message.success(data.deduped ? "该版本和选择已导入，未产生重复剧本" : `导入完成：新增 ${counts.created}，更新 ${counts.updated}，未变化 ${counts.unchanged}`);
    emit("imported");
    visible.value = false;
    reset();
  } catch (error) {
    window.$message.error((error as any)?.message || "正式导入失败");
  } finally {
    loading.value = false;
  }
}

function reset() {
  preview.value = null;
  selectedChapterIds.value = [];
  apiToken.value = "";
  if (fileInput.value) fileInput.value.value = "";
}
</script>

<style scoped lang="scss">
.sourcePane, .previewPane { display: flex; flex-direction: column; gap: 14px; }
.sourceForm { display: flex; flex-direction: column; gap: 10px; padding-top: 14px; }
.apiForm { max-width: 760px; }
.muted, .checksum { color: var(--td-text-color-secondary); font-size: 12px; }
.footerActions { display: flex; justify-content: flex-end; gap: 10px; }
.summaryGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.summaryGrid div { padding: 14px; border: 1px solid var(--td-component-border); border-radius: 8px; display: flex; flex-direction: column; gap: 4px; }
.summaryGrid strong { font-size: 20px; }
.summaryGrid span { color: var(--td-text-color-secondary); }
.characterLine { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.chapterPreview { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 900px) { .summaryGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
