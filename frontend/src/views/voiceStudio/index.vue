<template>
  <div class="voiceStudio">
    <div class="header">
      <div>
        <h2>配音与字幕</h2>
        <p>按角色管理音色，把剧本拆成可恢复的逐句配音，并校准字幕时间。</p>
      </div>
      <t-space>
        <t-button variant="outline" :disabled="!projectId" @click="openCastDialog">角色音色</t-button>
        <t-button variant="outline" :disabled="!selectedScriptId" :loading="importing" @click="importUtterances">导入台词</t-button>
        <t-button :disabled="selectedUtteranceIds.length === 0" :loading="generating" @click="batchGenerate">
          生成所选配音
        </t-button>
      </t-space>
    </div>

    <t-alert
      v-if="!projectId"
      theme="warning"
      message="请先从“我的项目”进入一个项目，再使用配音与字幕。"
      class="notice" />
    <template v-else>
      <div class="toolbar">
        <t-select
          v-model="selectedScriptId"
          label="剧本"
          placeholder="请选择剧本"
          :options="scriptOptions"
          :loading="loadingScripts"
          clearable
          @change="() => loadWorkspace()" />
        <t-checkbox v-model="includeStoryboardDescriptions">同时导入分镜描述</t-checkbox>
        <span class="boundary">当前供应商的 TTS 仍需配置真实适配器；空实现会明确失败，不会生成伪音频。</span>
      </div>

      <t-tabs v-model="activeTab">
        <t-tab-panel value="utterances" :label="`逐句台词 (${utterances.length})`">
          <t-table
            row-key="id"
            :columns="utteranceColumns"
            :data="utterances"
            :loading="loading"
            :selected-row-keys="selectedUtteranceIds"
            hover
            stripe
            table-layout="fixed"
            @select-change="onUtteranceSelect">
            <template #kind="{ row }">
              <t-tag :theme="row.kind === 'dialogue' ? 'primary' : row.kind === 'chorus' ? 'warning' : 'default'" variant="light">
                {{ kindLabel(row.kind) }}
              </t-tag>
            </template>
            <template #text="{ row }">
              <div class="textCell">{{ row.text }}</div>
            </template>
            <template #voiceCastId="{ row }">
              <t-select
                :value="row.voiceCastId || undefined"
                :options="castOptions"
                placeholder="未分配音色"
                clearable
                size="small"
                @change="(value) => assignCast(row, value as string | undefined)" />
            </template>
            <template #status="{ row }">
              <t-tag :theme="statusTheme(row.status)" variant="light">{{ statusLabel(row.status) }}</t-tag>
              <t-tooltip v-if="row.errorMessage" :content="row.errorMessage">
                <span class="errorDot">!</span>
              </t-tooltip>
            </template>
            <template #locked="{ row }">
              <t-switch :value="row.locked" size="small" @change="(value) => toggleUtteranceLock(row, Boolean(value))" />
            </template>
            <template #operation="{ row }">
              <t-space :size="4">
                <t-button size="small" variant="text" @click="editUtterance(row)">编辑</t-button>
                <t-button
                  size="small"
                  variant="text"
                  :disabled="!row.voiceCastId || ['queued', 'generating'].includes(row.status)"
                  @click="generateOne(row)">
                  生成
                </t-button>
              </t-space>
            </template>
          </t-table>
        </t-tab-panel>

        <t-tab-panel value="cues" :label="`字幕 cue (${cues.length})`">
          <div class="cueActions">
            <t-alert theme="info" message="重建只会覆盖未锁定的 cue；有真实音频时可填写句子时长后再重建。" />
            <t-space>
              <t-button variant="outline" :disabled="!selectedScriptId" @click="rebuildCues">重建未锁定 cue</t-button>
              <t-dropdown :options="exportOptions" @click="exportSubtitles">
                <t-button :disabled="cues.length === 0">导出字幕</t-button>
              </t-dropdown>
            </t-space>
          </div>
          <t-table row-key="id" :columns="cueColumns" :data="cues" :loading="loading" hover stripe>
            <template #time="{ row }">{{ formatMilliseconds(row.startMs) }} → {{ formatMilliseconds(row.endMs) }}</template>
            <template #text="{ row }"><div class="textCell">{{ row.text }}</div></template>
            <template #locked="{ row }">
              <t-switch :value="row.locked" size="small" @change="(value) => toggleCueLock(row, Boolean(value))" />
            </template>
            <template #operation="{ row }">
              <t-button size="small" variant="text" @click="editCue(row)">校准</t-button>
            </template>
          </t-table>
        </t-tab-panel>
      </t-tabs>
    </template>

    <t-dialog v-model:visible="castDialogVisible" header="角色音色" width="900px" :footer="false">
      <div class="dialogGrid">
        <div class="castList">
          <div class="sectionTitle">已有音色</div>
          <t-table row-key="id" :columns="castColumns" :data="casts" size="small" max-height="430px">
            <template #name="{ row }">
              {{ row.name }}
              <t-tag v-if="row.isDefault" size="small" theme="success" variant="light">默认</t-tag>
            </template>
            <template #model="{ row }">{{ row.provider }}:{{ row.model }}</template>
            <template #operation="{ row }"><t-button size="small" variant="text" @click="fillCastForm(row)">编辑</t-button></template>
          </t-table>
        </div>
        <div class="castForm">
          <div class="sectionTitle">{{ castForm.id ? "编辑音色" : "新增音色" }}</div>
          <t-form label-align="top">
            <t-form-item label="角色资产">
              <t-select v-model="castForm.roleAssetId" :options="roleOptions" clearable placeholder="旁白/默认音色可不选" />
            </t-form-item>
            <t-form-item label="显示名称"><t-input v-model="castForm.name" placeholder="如：小明、旁白" /></t-form-item>
            <div class="threeColumns">
              <t-form-item label="供应商"><t-input v-model="castForm.provider" placeholder="供应商 ID" /></t-form-item>
              <t-form-item label="模型"><t-input v-model="castForm.model" placeholder="TTS 模型名" /></t-form-item>
              <t-form-item label="音色"><t-input v-model="castForm.voice" placeholder="voice ID" /></t-form-item>
            </div>
            <t-form-item label="试听/参考音频">
              <t-select v-model="castForm.previewAssetId" :options="audioOptions" clearable placeholder="可选上传的音色资产" />
            </t-form-item>
            <div class="threeColumns">
              <t-form-item label="语速"><t-input-number v-model="castForm.speechRate" :min="0.25" :max="4" :step="0.05" /></t-form-item>
              <t-form-item label="音高"><t-input-number v-model="castForm.pitchRate" :min="-12" :max="12" :step="0.5" /></t-form-item>
              <t-form-item label="音量"><t-input-number v-model="castForm.volume" :min="0" :max="4" :step="0.05" /></t-form-item>
            </div>
            <t-form-item label="情绪"><t-input v-model="castForm.emotion" placeholder="可选，由供应商决定是否支持" /></t-form-item>
            <t-form-item label="设为项目默认"><t-switch v-model="castForm.isDefault" /></t-form-item>
            <t-space>
              <t-button :loading="savingCast" @click="saveCast">保存音色</t-button>
              <t-button variant="outline" @click="resetCastForm">新建</t-button>
            </t-space>
          </t-form>
        </div>
      </div>
    </t-dialog>

    <t-dialog v-model:visible="utteranceDialogVisible" header="编辑逐句台词" :on-confirm="saveUtterance">
      <t-form label-align="top">
        <t-form-item label="类型"><t-select v-model="utteranceForm.kind" :options="kindOptions" /></t-form-item>
        <t-form-item label="说话人"><t-input v-model="utteranceForm.speaker" /></t-form-item>
        <t-form-item label="台词"><t-textarea v-model="utteranceForm.text" :autosize="{ minRows: 4, maxRows: 9 }" /></t-form-item>
        <t-form-item label="已知音频时长（毫秒）">
          <t-input-number v-model="utteranceForm.durationMs" :min="1" :max="3_600_000" clearable />
        </t-form-item>
        <t-form-item label="锁定人工修改"><t-switch v-model="utteranceForm.locked" /></t-form-item>
      </t-form>
    </t-dialog>

    <t-dialog v-model:visible="cueDialogVisible" header="校准字幕 cue" :on-confirm="saveCue">
      <t-form label-align="top">
        <div class="twoColumns">
          <t-form-item label="开始（毫秒）"><t-input-number v-model="cueForm.startMs" :min="0" /></t-form-item>
          <t-form-item label="结束（毫秒）"><t-input-number v-model="cueForm.endMs" :min="1" /></t-form-item>
        </div>
        <t-form-item label="字幕"><t-textarea v-model="cueForm.text" :autosize="{ minRows: 3, maxRows: 7 }" /></t-form-item>
        <t-form-item label="锁定人工时间"><t-switch v-model="cueForm.locked" /></t-form-item>
      </t-form>
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import axios from "@/utils/axios";
import projectStore from "@/stores/project";

interface VoiceCast {
  id: string;
  roleAssetId: number | null;
  name: string;
  provider: string;
  model: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
  emotion: string | null;
  isDefault: boolean;
  previewAssetId: number | null;
}

interface Utterance {
  id: string;
  kind: "dialogue" | "narration" | "chorus";
  speaker: string;
  text: string;
  voiceCastId: string | null;
  durationMs: number | null;
  status: string;
  errorMessage: string | null;
  locked: boolean;
}

interface Cue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  locked: boolean;
}

const { project } = storeToRefs(projectStore());
const projectId = computed(() => (project.value?.id ? Number(project.value.id) : 0));
const activeTab = ref("utterances");
const loading = ref(false);
const loadingScripts = ref(false);
const importing = ref(false);
const generating = ref(false);
const savingCast = ref(false);
const selectedScriptId = ref<number>();
const includeStoryboardDescriptions = ref(false);
const scriptOptions = ref<Array<{ label: string; value: number }>>([]);
const roleOptions = ref<Array<{ label: string; value: number }>>([]);
const audioOptions = ref<Array<{ label: string; value: number }>>([]);
const casts = ref<VoiceCast[]>([]);
const utterances = ref<Utterance[]>([]);
const cues = ref<Cue[]>([]);
const selectedUtteranceIds = ref<Array<string | number>>([]);
const castDialogVisible = ref(false);
const utteranceDialogVisible = ref(false);
const cueDialogVisible = ref(false);

const emptyCastForm = () => ({
  id: undefined as string | undefined,
  roleAssetId: undefined as number | undefined,
  name: "",
  provider: "",
  model: "",
  voice: "",
  previewAssetId: undefined as number | undefined,
  speechRate: 1,
  pitchRate: 0,
  volume: 1,
  emotion: "",
  isDefault: false,
});
const castForm = ref(emptyCastForm());
const utteranceForm = ref({ id: "", kind: "dialogue" as Utterance["kind"], speaker: "", text: "", durationMs: undefined as number | undefined, locked: false });
const cueForm = ref({ id: "", startMs: 0, endMs: 1, text: "", locked: false });

const utteranceColumns: any[] = [
  { colKey: "row-select", type: "multiple", width: 48, fixed: "left" },
  { colKey: "kind", title: "类型", width: 80, cell: "kind" },
  { colKey: "speaker", title: "说话人", width: 110, ellipsis: true },
  { colKey: "text", title: "台词", minWidth: 300, cell: "text" },
  { colKey: "voiceCastId", title: "角色音色", width: 200, cell: "voiceCastId" },
  { colKey: "status", title: "状态", width: 110, cell: "status" },
  { colKey: "locked", title: "锁定", width: 70, cell: "locked" },
  { colKey: "operation", title: "操作", width: 130, fixed: "right", cell: "operation" },
];
const cueColumns: any[] = [
  { colKey: "time", title: "时间", width: 230, cell: "time" },
  { colKey: "text", title: "字幕", cell: "text" },
  { colKey: "locked", title: "锁定", width: 80, cell: "locked" },
  { colKey: "operation", title: "操作", width: 90, cell: "operation" },
];
const castColumns: any[] = [
  { colKey: "name", title: "名称", cell: "name" },
  { colKey: "model", title: "模型", ellipsis: true, cell: "model" },
  { colKey: "voice", title: "音色", ellipsis: true },
  { colKey: "operation", title: "操作", width: 65, cell: "operation" },
];
const castOptions = computed(() => casts.value.map((item) => ({ label: `${item.name} · ${item.voice}`, value: item.id })));
const kindOptions = [
  { label: "对白", value: "dialogue" },
  { label: "旁白", value: "narration" },
  { label: "群声", value: "chorus" },
];
const exportOptions = [
  { content: "SRT", value: "srt" },
  { content: "WebVTT", value: "vtt" },
];

let refreshTimer: ReturnType<typeof setInterval> | undefined;

onMounted(async () => {
  if (!projectId.value) return;
  await Promise.all([loadScripts(), loadCasts(), loadAssets()]);
  refreshTimer = setInterval(() => {
    if (selectedScriptId.value && document.visibilityState === "visible") void loadWorkspace(false);
  }, 5000);
});

onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});

async function loadScripts() {
  loadingScripts.value = true;
  try {
    const { data } = await axios.post("/script/getScrptApi", { projectId: projectId.value });
    scriptOptions.value = data.map((item: any) => ({ label: item.name, value: item.id }));
    if (!selectedScriptId.value && scriptOptions.value.length) selectedScriptId.value = scriptOptions.value[0].value;
    if (selectedScriptId.value) await loadWorkspace();
  } catch (error) {
    showError(error, "获取剧本失败");
  } finally {
    loadingScripts.value = false;
  }
}

async function loadAssets() {
  try {
    const [{ data: roleData }, { data: audioData }] = await Promise.all([
      axios.post("/cornerScape/getAllAssets", { projectId: projectId.value, type: ["role"] }),
      axios.post("/assets/getAssetsApi", { projectId: projectId.value, type: "audio", page: 1, limit: 500 }),
    ]);
    roleOptions.value = roleData.map((item: any) => ({ label: item.name, value: item.id }));
    audioOptions.value = audioData.data.flatMap((group: any) =>
      (group.sonAssets || []).map((item: any) => ({ label: `${group.name} / ${item.name}`, value: item.id })),
    );
  } catch (error) {
    showError(error, "获取角色或音色资产失败");
  }
}

async function loadCasts() {
  const { data } = await axios.post("/voiceStudio/casts/list", { projectId: projectId.value });
  casts.value = data;
}

async function loadWorkspace(showLoading = true) {
  selectedUtteranceIds.value = [];
  if (!selectedScriptId.value) {
    utterances.value = [];
    cues.value = [];
    return;
  }
  if (showLoading) loading.value = true;
  try {
    const [{ data: utteranceData }, { data: cueData }] = await Promise.all([
      axios.post("/voiceStudio/utterances/list", { projectId: projectId.value, scriptId: selectedScriptId.value }),
      axios.post("/voiceStudio/cues/list", { projectId: projectId.value, scriptId: selectedScriptId.value }),
    ]);
    utterances.value = utteranceData;
    cues.value = cueData;
  } catch (error) {
    showError(error, "获取配音工作区失败");
  } finally {
    if (showLoading) loading.value = false;
  }
}

async function importUtterances() {
  if (!selectedScriptId.value) return;
  importing.value = true;
  try {
    const { data } = await axios.post("/voiceStudio/utterances/import", {
      projectId: projectId.value,
      scriptId: selectedScriptId.value,
      includeStoryboardDescriptions: includeStoryboardDescriptions.value,
    });
    window.$message.success(`已导入 ${data.imported} 句，保留 ${data.preservedLocked} 句锁定内容`);
    await loadWorkspace();
  } catch (error) {
    showError(error, "导入台词失败");
  } finally {
    importing.value = false;
  }
}

function onUtteranceSelect(keys: Array<string | number>) {
  selectedUtteranceIds.value = keys;
}

async function assignCast(row: Utterance, voiceCastId?: string) {
  await updateUtterance({ id: row.id, voiceCastId: voiceCastId || null });
}

async function toggleUtteranceLock(row: Utterance, locked: boolean) {
  await updateUtterance({ id: row.id, locked });
}

async function updateUtterance(values: Record<string, unknown>) {
  try {
    await axios.post("/voiceStudio/utterances/update", { projectId: projectId.value, ...values });
    await loadWorkspace();
  } catch (error) {
    showError(error, "更新台词失败");
  }
}

function editUtterance(row: Utterance) {
  utteranceForm.value = {
    id: row.id,
    kind: row.kind,
    speaker: row.speaker,
    text: row.text,
    durationMs: row.durationMs ?? undefined,
    locked: row.locked,
  };
  utteranceDialogVisible.value = true;
}

async function saveUtterance() {
  if (!utteranceForm.value.speaker.trim() || !utteranceForm.value.text.trim()) {
    window.$message.warning("说话人和台词不能为空");
    return false;
  }
  await updateUtterance(utteranceForm.value);
  utteranceDialogVisible.value = false;
  return true;
}

async function generateOne(row: Utterance) {
  try {
    await axios.post("/voiceStudio/utterances/generate", {
      projectId: projectId.value,
      utteranceId: row.id,
      requestId: crypto.randomUUID(),
    });
    window.$message.success("已进入持久配音队列");
    await loadWorkspace();
  } catch (error) {
    showError(error, "配音入队失败");
  }
}

async function batchGenerate() {
  generating.value = true;
  try {
    await axios.post("/voiceStudio/utterances/batchGenerate", {
      projectId: projectId.value,
      utteranceIds: selectedUtteranceIds.value.map(String),
      requestId: crypto.randomUUID(),
    });
    window.$message.success(`${selectedUtteranceIds.value.length} 句已进入持久配音队列`);
    await loadWorkspace();
  } catch (error) {
    showError(error, "批量配音入队失败，请确认所选台词都已分配音色");
  } finally {
    generating.value = false;
  }
}

async function openCastDialog() {
  await Promise.all([loadCasts(), loadAssets()]);
  castDialogVisible.value = true;
}

function fillCastForm(row: VoiceCast) {
  castForm.value = {
    id: row.id,
    roleAssetId: row.roleAssetId ?? undefined,
    name: row.name,
    provider: row.provider,
    model: row.model,
    voice: row.voice,
    previewAssetId: row.previewAssetId ?? undefined,
    speechRate: row.speechRate,
    pitchRate: row.pitchRate,
    volume: row.volume,
    emotion: row.emotion ?? "",
    isDefault: row.isDefault,
  };
}

function resetCastForm() {
  castForm.value = emptyCastForm();
}

async function saveCast() {
  const form = castForm.value;
  if (!form.name.trim() || !form.provider.trim() || !form.model.trim() || !form.voice.trim()) {
    window.$message.warning("名称、供应商、模型和音色不能为空");
    return;
  }
  savingCast.value = true;
  try {
    await axios.post("/voiceStudio/casts/upsert", {
      ...form,
      projectId: projectId.value,
      roleAssetId: form.roleAssetId ?? null,
      previewAssetId: form.previewAssetId ?? null,
      emotion: form.emotion.trim() || null,
    });
    window.$message.success("角色音色已保存");
    resetCastForm();
    await Promise.all([loadCasts(), loadWorkspace()]);
  } catch (error) {
    showError(error, "保存角色音色失败");
  } finally {
    savingCast.value = false;
  }
}

async function rebuildCues() {
  if (!selectedScriptId.value) return;
  try {
    const { data } = await axios.post("/voiceStudio/cues/rebuild", {
      projectId: projectId.value,
      scriptId: selectedScriptId.value,
    });
    cues.value = data;
    window.$message.success("未锁定字幕已重建");
  } catch (error) {
    showError(error, "重建字幕失败");
  }
}

function editCue(row: Cue) {
  cueForm.value = { ...row };
  cueDialogVisible.value = true;
}

async function toggleCueLock(row: Cue, locked: boolean) {
  try {
    await axios.post("/voiceStudio/cues/update", { id: row.id, projectId: projectId.value, locked });
    await loadWorkspace();
  } catch (error) {
    showError(error, "更新字幕失败");
  }
}

async function saveCue() {
  if (cueForm.value.endMs <= cueForm.value.startMs || !cueForm.value.text.trim()) {
    window.$message.warning("字幕文本不能为空，结束时间必须晚于开始时间");
    return false;
  }
  try {
    await axios.post("/voiceStudio/cues/update", { ...cueForm.value, projectId: projectId.value });
    cueDialogVisible.value = false;
    await loadWorkspace();
    return true;
  } catch (error) {
    showError(error, "保存字幕失败");
    return false;
  }
}

async function exportSubtitles(option: any) {
  if (!selectedScriptId.value) return;
  try {
    const format = option.value === "vtt" ? "vtt" : "srt";
    const { data } = await axios.post("/voiceStudio/cues/export", {
      projectId: projectId.value,
      scriptId: selectedScriptId.value,
      format,
    });
    const blob = new Blob([data.content], { type: format === "srt" ? "application/x-subrip" : "text/vtt" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${scriptOptions.value.find((item) => item.value === selectedScriptId.value)?.label || "subtitles"}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    showError(error, "导出字幕失败");
  }
}

function kindLabel(kind: Utterance["kind"]) {
  return kind === "dialogue" ? "对白" : kind === "chorus" ? "群声" : "旁白";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "待分配",
    ready: "待生成",
    queued: "排队中",
    generating: "生成中",
    retry_wait: "等待重试",
    blocked: "已阻塞",
    cancelling: "取消中",
    cancelled: "已取消",
    succeeded: "已完成",
    failed: "生成失败",
    manual_review: "需人工确认",
  };
  return labels[status] || status;
}

function statusTheme(status: string): "default" | "primary" | "warning" | "danger" | "success" {
  if (status === "succeeded") return "success";
  if (["failed", "manual_review"].includes(status)) return "danger";
  if (["retry_wait", "blocked", "cancelling"].includes(status)) return "warning";
  if (["queued", "generating"].includes(status)) return "primary";
  return "default";
}

function formatMilliseconds(value: number) {
  const total = Math.max(0, value);
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1_000);
  const millis = total % 1_000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function showError(error: any, fallback: string) {
  const message = error?.message || error?.errors?.join("；") || fallback;
  window.$message.error(message === "参数错误" ? `${fallback}：参数错误` : message);
}
</script>

<style scoped lang="scss">
.voiceStudio {
  height: 100%;
  padding: 24px;
  overflow: auto;
  background: #f5f7fa;
  box-sizing: border-box;
}
.header,
.toolbar,
.cueActions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.header {
  margin-bottom: 16px;
  h2 { margin: 0 0 6px; font-size: 24px; }
  p { margin: 0; color: #6b7280; }
}
.notice { margin-top: 16px; }
.toolbar {
  justify-content: flex-start;
  padding: 16px;
  margin-bottom: 12px;
  border-radius: 10px;
  background: #fff;
  .t-select { width: 280px; }
}
.boundary { color: #9a6700; font-size: 12px; }
:deep(.t-tabs__content) {
  padding: 16px;
  background: #fff;
  border-radius: 0 0 10px 10px;
}
.textCell { white-space: pre-wrap; line-height: 1.6; }
.errorDot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: 4px;
  border-radius: 50%;
  color: #fff;
  background: #d54941;
  font-size: 11px;
}
.cueActions { margin-bottom: 14px; }
.cueActions .t-alert { flex: 1; }
.dialogGrid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 24px;
}
.sectionTitle { margin-bottom: 12px; font-size: 16px; font-weight: 600; }
.castForm { padding-left: 24px; border-left: 1px solid #e7e7e7; }
.threeColumns,
.twoColumns { display: grid; gap: 12px; }
.threeColumns { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.twoColumns { grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 1100px) {
  .header, .toolbar, .cueActions { align-items: flex-start; flex-direction: column; }
  .dialogGrid { grid-template-columns: 1fr; }
  .castForm { padding: 20px 0 0; border-left: 0; border-top: 1px solid #e7e7e7; }
}
</style>
