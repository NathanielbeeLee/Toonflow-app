<template>
  <div class="taskCenter">
    <div class="header">
      <div class="headerInfo fc">
        <span class="title">{{ $t("workbench.task.title") }}</span>
        <span class="sub">{{ $t("workbench.task.subtitle") }}</span>
      </div>
      <div class="headerActions f ac">
        <span v-if="activeTab === 'durable'" class="autoRefreshHint">{{ $t("workbench.task.durable.autoRefresh") }}</span>
        <t-button v-if="activeTab === 'durable'" variant="outline" @click="openBudget">预算与价格</t-button>
        <t-button v-if="activeTab === 'durable'" variant="outline" @click="openLimits">{{ $t("workbench.task.durable.limits.button") }}</t-button>
        <t-button @click="refreshActiveTab">
          <template #icon><i-redo :size="20" /></template>
          {{ $t("workbench.task.refresh") }}
        </t-button>
      </div>
    </div>

    <t-tabs v-model="activeTab" @change="handleTabChange">
      <t-tab-panel value="durable" :label="$t('workbench.task.durable.tab')">
        <div class="filterBar f ac">
          <t-select
            :label="$t('workbench.task.project')"
            v-model="selectedProjectId"
            :options="projectOptions"
            @change="onDurableFilterChange" />
          <t-select
            :label="$t('workbench.task.durable.laneLabel')"
            v-model="durableLane"
            :options="laneOptions"
            @change="onDurableFilterChange" />
          <t-select
            :label="$t('workbench.task.stateLabel')"
            v-model="durableStatus"
            :options="durableStatusOptions"
            @change="onDurableFilterChange" />
        </div>

        <t-alert theme="info" :message="$t('workbench.task.durable.safetyHint')" class="safetyHint" />

        <t-table
          :data="durableTaskList"
          :columns="durableColumns"
          row-key="id"
          :loading="durablePagination.loading"
          hover
          stripe>
          <template #type="{ row }">
            <div class="taskTypeCell">
              <span>{{ taskTypeLabel(row.type) }}</span>
              <t-tooltip :content="row.id"><span class="taskId">{{ shortId(row.id) }}</span></t-tooltip>
            </div>
          </template>
          <template #status="{ row }">
            <t-tag :theme="statusTheme(row.status)" variant="light">{{ statusLabel(row.status) }}</t-tag>
          </template>
          <template #provider="{ row }">
            <div>{{ row.provider || "-" }}</div>
            <t-tooltip v-if="row.providerJobId" :content="row.providerJobId">
              <span class="providerJobId">{{ shortId(row.providerJobId) }}</span>
            </t-tooltip>
          </template>
          <template #attempts="{ row }">{{ row.attempts }} / {{ row.maxAttempts }}</template>
          <template #errorMessage="{ row }">
            <t-tooltip v-if="row.errorMessage" :content="row.errorMessage" placement="top">
              <span class="errorMessage">{{ row.errorMessage }}</span>
            </t-tooltip>
            <span v-else>-</span>
          </template>
          <template #createdAt="{ row }">{{ formatTime(row.createdAt) }}</template>
          <template #operation="{ row }">
            <div class="operations f ac">
              <t-button
                v-if="canCancel(row.status)"
                size="small"
                variant="outline"
                theme="danger"
                :loading="actionTaskId === row.id"
                @click="confirmCancel(row)">
                {{ $t("workbench.task.durable.cancel") }}
              </t-button>
              <t-button
                v-if="canRetry(row.status)"
                size="small"
                variant="outline"
                theme="primary"
                :loading="actionTaskId === row.id"
                @click="confirmRetry(row)">
                {{ row.status === "manual_review" ? $t("workbench.task.durable.confirmRetry") : $t("workbench.task.durable.retry") }}
              </t-button>
              <span v-if="!canCancel(row.status) && !canRetry(row.status)" class="noOperation">-</span>
            </div>
          </template>
        </t-table>

        <t-pagination
          class="paginationWrap"
          v-model:current="durablePagination.page"
          v-model:pageSize="durablePagination.limit"
          show-sizer
          :total="durablePagination.total"
          @page-size-change="() => getDurableTasks()"
          @current-change="() => getDurableTasks()" />
      </t-tab-panel>

      <t-tab-panel value="legacy" :label="$t('workbench.task.legacyTab')">
        <div class="filterBar f ac">
          <t-select :label="$t('workbench.task.project')" v-model="selectedProjectId" :options="projectOptions" @change="onLegacyFilterChange" />
          <t-select
            :label="$t('workbench.task.categoryLabel')"
            v-model="taskClass"
            :options="categoryOptions"
            @change="onLegacyFilterChange" />
          <t-select :label="$t('workbench.task.stateLabel')" v-model="taskState" :options="legacyStateOptions" @change="onLegacyFilterChange" />
        </div>
        <t-table :data="legacyTaskList" :columns="legacyColumns" row-key="id" :loading="legacyPagination.loading" hover stripe>
          <template #state="{ row }">
            <t-tooltip v-if="row.state === '生成失败'" :content="row.reason || $t('workbench.task.noFailReason')" placement="top">
              <span class="stateText stateFail">{{ row.state }}</span>
            </t-tooltip>
            <span v-else class="stateText" :class="row.state === '进行中' ? 'stateRunning' : 'stateSuccess'">{{ row.state }}</span>
          </template>
          <template #startTime="{ row }">{{ formatTime(row.startTime) }}</template>
        </t-table>
        <t-pagination
          class="paginationWrap"
          v-model:current="legacyPagination.page"
          v-model:pageSize="legacyPagination.limit"
          show-sizer
          :total="legacyPagination.total"
          @page-size-change="getLegacyTasks"
          @current-change="getLegacyTasks" />
      </t-tab-panel>
    </t-tabs>

    <t-dialog
      v-model:visible="limitDialogVisible"
      :header="$t('workbench.task.durable.limits.title')"
      width="760px"
      :confirm-btn="$t('workbench.task.durable.limits.save')"
      :cancel-btn="$t('workbench.task.durable.close')"
      :on-confirm="saveLimit">
      <t-alert theme="info" :message="$t('workbench.task.durable.limits.hint')" class="limitHint" />
      <div class="limitForm">
        <t-input v-model="limitForm.provider" :label="$t('workbench.task.durable.limits.provider')" placeholder="openai" />
        <t-input v-model="limitForm.model" :label="$t('workbench.task.durable.limits.model')" placeholder="*" />
        <t-select v-model="limitForm.lane" :label="$t('workbench.task.durable.limits.lane')" :options="laneOptions.slice(1)" />
        <t-input-number v-model="limitForm.maxConcurrency" :label="$t('workbench.task.durable.limits.concurrency')" :min="1" :max="32" />
        <t-input-number v-model="limitForm.rpm" label="RPM" :min="1" :max="10000" />
        <t-input-number v-model="limitForm.cooldownMs" :label="$t('workbench.task.durable.limits.cooldown')" :min="0" :max="60000" />
      </div>
      <t-table :data="limitRows" :columns="limitColumns" row-key="key" size="small" :loading="limitsLoading">
        <template #operation="{ row }">
          <t-button size="small" variant="text" @click="editLimit(row)">{{ $t("workbench.task.durable.limits.edit") }}</t-button>
        </template>
      </t-table>
    </t-dialog>

    <t-dialog v-model:visible="budgetDialogVisible" header="项目预算与模型价格" width="900px" :footer="false">
      <t-alert theme="info" message="价格必须由你按供应商账单配置，系统不会猜价。已知价格会在入队前预留预算；开启阻止未知价格后，没有规则的生成任务将被拒绝。复合任务当前只预留列表中的主模型费用。" />
      <div class="budgetSummary">
        <t-select v-model="budgetProjectId" label="项目" :options="projectOptions.filter((item) => item.value !== '')" @change="loadBudget" />
        <t-input-number v-model="budgetForm.budgetLimit" label="预算上限" :min="0" clearable />
        <t-select v-model="budgetForm.currency" label="币种" :options="currencyOptions" />
        <div class="switchField"><span>阻止未知价格</span><t-switch v-model="budgetForm.blockUnknownPrice" /></div>
        <t-button :disabled="!budgetProjectId" @click="saveBudget">保存项目预算</t-button>
      </div>
      <div v-if="budgetInfo" class="budgetNumbers">
        <span>已预留：{{ budgetInfo.reservedCost.toFixed(4) }} {{ budgetInfo.currency }}</span>
        <span>剩余：{{ budgetInfo.remaining == null ? '未设上限' : `${budgetInfo.remaining.toFixed(4)} ${budgetInfo.currency}` }}</span>
      </div>
      <div class="sectionTitle">模型价格规则</div>
      <div class="pricingForm">
        <t-input v-model="pricingForm.provider" label="供应商" placeholder="openai" />
        <t-input v-model="pricingForm.model" label="模型" placeholder="*" />
        <t-select v-model="pricingForm.lane" label="通道" :options="laneOptions.slice(1)" />
        <t-select v-model="pricingForm.unitType" label="计价单位" :options="pricingUnitOptions" />
        <t-input-number v-model="pricingForm.unitPrice" label="单价" :min="0" :decimal-places="6" />
        <t-select v-model="pricingForm.currency" label="币种" :options="currencyOptions" />
        <t-button @click="savePricingRule">{{ pricingForm.id ? '更新规则' : '新增规则' }}</t-button>
      </div>
      <t-table :data="pricingRules" :columns="pricingColumns" row-key="id" size="small">
        <template #unit="{ row }">{{ row.unitPrice }} / {{ pricingUnitLabel(row.unitType) }}</template>
        <template #operation="{ row }">
          <t-space :size="4">
            <t-button size="small" variant="text" @click="editPricingRule(row)">编辑</t-button>
            <t-button size="small" variant="text" theme="danger" @click="removePricingRule(row)">删除</t-button>
          </t-space>
        </template>
      </t-table>
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import dayjs from "dayjs";
import axios from "@/utils/axios";
import projectStore from "@/stores/project";
import type { TabValue, TableProps } from "tdesign-vue-next";

type DurableStatus =
  | "queued"
  | "claimed"
  | "submitting"
  | "submitted"
  | "polling"
  | "finalizing"
  | "retry_wait"
  | "blocked"
  | "cancelling"
  | "cancelled"
  | "succeeded"
  | "failed"
  | "manual_review";
type DurableLane = "text" | "image" | "video" | "audio" | "compose" | "qa" | "publish";

interface DurableTask {
  id: string;
  projectId: number;
  lane: DurableLane;
  type: string;
  resourceKey: string | null;
  status: DurableStatus;
  attempts: number;
  maxAttempts: number;
  provider: string | null;
  providerJobId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  cancelRequested: boolean;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

interface LegacyTask {
  id: number;
  taskClass: string;
  relatedObjects: string;
  model: string;
  state: string;
  startTime: number;
  describe?: string;
  reason?: string;
}

interface ProviderLimit {
  key?: string;
  provider: string;
  model: string;
  lane: DurableLane;
  maxConcurrency: number;
  rpm: number;
  cooldownMs: number;
}

interface PricingRule {
  id: string;
  provider: string;
  model: string;
  lane: DurableLane;
  unitType: "request" | "second" | "character";
  unitPrice: number;
  currency: "CNY" | "USD";
}

interface BudgetInfo {
  budgetLimit: number | null;
  currency: "CNY" | "USD";
  blockUnknownPrice: boolean;
  reservedCost: number;
  remaining: number | null;
}

const { project } = storeToRefs(projectStore());
const activeTab = ref<"durable" | "legacy">("durable");
const selectedProjectId = ref<number | "">(project.value?.id ? Number(project.value.id) : "");
const projectOptions = ref<{ label: string; value: number | "" }[]>([]);

const durableTaskList = ref<DurableTask[]>([]);
const durableStatus = ref<DurableStatus | "">("");
const durableLane = ref<DurableLane | "">("");
const durablePagination = ref({ page: 1, limit: 10, total: 0, loading: false });
const actionTaskId = ref("");
const limitDialogVisible = ref(false);
const limitsLoading = ref(false);
const limitRows = ref<ProviderLimit[]>([]);
const limitForm = ref<ProviderLimit>({ provider: "", model: "*", lane: "video", maxConcurrency: 2, rpm: 10, cooldownMs: 0 });
const budgetDialogVisible = ref(false);
const budgetProjectId = ref<number | "">(selectedProjectId.value);
const budgetInfo = ref<BudgetInfo | null>(null);
const budgetForm = ref<{ budgetLimit: number | undefined; currency: "CNY" | "USD"; blockUnknownPrice: boolean }>({ budgetLimit: undefined, currency: "CNY", blockUnknownPrice: false });
const pricingRules = ref<PricingRule[]>([]);
const emptyPricingForm = () => ({ id: undefined as string | undefined, provider: "", model: "*", lane: "video" as DurableLane, unitType: "second" as PricingRule["unitType"], unitPrice: 0, currency: "CNY" as PricingRule["currency"] });
const pricingForm = ref(emptyPricingForm());

const legacyTaskList = ref<LegacyTask[]>([]);
const taskClass = ref("");
const taskState = ref("");
const categoryOptions = ref<{ label: string; value: string }[]>([]);
const legacyPagination = ref({ page: 1, limit: 10, total: 0, loading: false });

const durableColumns: TableProps["columns"] = [
  { colKey: "type", title: $t("workbench.task.durable.col.type"), width: 170, cell: "type" },
  { colKey: "lane", title: $t("workbench.task.durable.col.lane"), width: 90 },
  { colKey: "resourceKey", title: $t("workbench.task.durable.col.resource"), width: 160, ellipsis: true },
  { colKey: "status", title: $t("workbench.task.col.state"), width: 110, cell: "status" },
  { colKey: "provider", title: $t("workbench.task.durable.col.provider"), width: 150, cell: "provider" },
  { colKey: "attempts", title: $t("workbench.task.durable.col.attempts"), width: 90, cell: "attempts" },
  { colKey: "errorMessage", title: $t("workbench.task.durable.col.message"), ellipsis: true, cell: "errorMessage" },
  { colKey: "createdAt", title: $t("workbench.task.col.startTime"), width: 170, cell: "createdAt" },
  { colKey: "operation", title: $t("workbench.task.durable.col.operation"), width: 180, fixed: "right", cell: "operation" },
];

const limitColumns: TableProps["columns"] = [
  { colKey: "provider", title: $t("workbench.task.durable.limits.provider"), width: 100 },
  { colKey: "model", title: $t("workbench.task.durable.limits.model"), width: 150, ellipsis: true },
  { colKey: "lane", title: $t("workbench.task.durable.limits.lane"), width: 80 },
  { colKey: "maxConcurrency", title: $t("workbench.task.durable.limits.concurrency"), width: 80 },
  { colKey: "rpm", title: "RPM", width: 70 },
  { colKey: "cooldownMs", title: $t("workbench.task.durable.limits.cooldown"), width: 100 },
  { colKey: "operation", title: $t("workbench.task.durable.col.operation"), width: 70, cell: "operation" },
];
const pricingColumns: TableProps["columns"] = [
  { colKey: "provider", title: "供应商", width: 100 },
  { colKey: "model", title: "模型", ellipsis: true },
  { colKey: "lane", title: "通道", width: 80 },
  { colKey: "unit", title: "单价", width: 150, cell: "unit" },
  { colKey: "currency", title: "币种", width: 70 },
  { colKey: "operation", title: "操作", width: 120, cell: "operation" },
];
const currencyOptions = [{ label: "人民币 CNY", value: "CNY" }, { label: "美元 USD", value: "USD" }];
const pricingUnitOptions = [{ label: "每次请求", value: "request" }, { label: "每秒", value: "second" }, { label: "每字符", value: "character" }];

const legacyColumns: TableProps["columns"] = [
  { colKey: "taskClass", title: $t("workbench.task.col.taskClass"), width: 120, ellipsis: true },
  { colKey: "relatedObjects", title: $t("workbench.task.col.relatedObjects"), width: 120, ellipsis: true },
  { colKey: "model", title: $t("workbench.task.col.model"), width: 240, ellipsis: true },
  { colKey: "describe", title: $t("workbench.task.col.describe"), ellipsis: true },
  { colKey: "reason", title: $t("workbench.task.col.reason"), ellipsis: true },
  { colKey: "state", title: $t("workbench.task.col.state"), width: 100, cell: "state" },
  { colKey: "startTime", title: $t("workbench.task.col.startTime"), width: 180, cell: "startTime" },
];

const durableStatuses: DurableStatus[] = [
  "queued",
  "claimed",
  "submitting",
  "submitted",
  "polling",
  "finalizing",
  "retry_wait",
  "blocked",
  "cancelling",
  "manual_review",
  "succeeded",
  "failed",
  "cancelled",
];
const durableStatusOptions = [
  { label: $t("workbench.task.stateAll"), value: "" },
  ...durableStatuses.map((value) => ({ label: statusLabel(value), value })),
];
const laneOptions = [
  { label: $t("workbench.task.stateAll"), value: "" },
  ...(["text", "image", "video", "audio", "compose", "qa", "publish"] as DurableLane[]).map((value) => ({
    label: $t(`workbench.task.durable.lanes.${value}`),
    value,
  })),
];
const legacyStateOptions = [
  { label: $t("workbench.task.stateAll"), value: "" },
  { label: $t("workbench.task.stateRunning"), value: "进行中" },
  { label: $t("workbench.task.stateCompleted"), value: "已完成" },
  { label: $t("workbench.task.stateFailed"), value: "生成失败" },
];

let refreshTimer: ReturnType<typeof setInterval> | undefined;

onMounted(async () => {
  await Promise.all([getProjects(), getCategories()]);
  await getDurableTasks();
  refreshTimer = setInterval(() => {
    if (activeTab.value === "durable" && document.visibilityState === "visible") getDurableTasks(false);
  }, 5000);
});

onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});

function handleTabChange(value: TabValue) {
  activeTab.value = value === "legacy" ? "legacy" : "durable";
  refreshActiveTab();
}

function refreshActiveTab() {
  return activeTab.value === "durable" ? getDurableTasks() : getLegacyTasks();
}

function onDurableFilterChange() {
  durablePagination.value.page = 1;
  getDurableTasks();
}

function onLegacyFilterChange() {
  legacyPagination.value.page = 1;
  getLegacyTasks();
}

async function getProjects() {
  const { data } = await axios.post("/task/getProject").catch(() => ({ data: [] }));
  projectOptions.value = [
    { label: $t("workbench.task.stateAll"), value: "" },
    ...data.map((item: { id: number; name: string }) => ({ label: item.name, value: item.id })),
  ];
}

async function getCategories() {
  const { data } = await axios.post("/task/getTaskCategories").catch(() => ({ data: [] }));
  categoryOptions.value = [
    { label: $t("workbench.task.stateAll"), value: "" },
    ...data.map((item: { taskClass: string }) => ({ label: item.taskClass, value: item.taskClass })),
  ];
}

async function getDurableTasks(showError = true) {
  durablePagination.value.loading = true;
  try {
    const { data } = await axios.post("/generationTasks/list", {
      page: durablePagination.value.page,
      limit: durablePagination.value.limit,
      ...(selectedProjectId.value !== "" ? { projectId: selectedProjectId.value } : {}),
      ...(durableLane.value ? { lane: durableLane.value } : {}),
      ...(durableStatus.value ? { status: durableStatus.value } : {}),
    });
    durableTaskList.value = data.data;
    durablePagination.value.total = Number(data.total);
  } catch (error) {
    if (showError) window.$message.error(errorText(error, $t("workbench.task.fetchFailed")));
  } finally {
    durablePagination.value.loading = false;
  }
}

async function getLegacyTasks() {
  legacyPagination.value.loading = true;
  try {
    const { data } = await axios.post("/task/getTaskApi", {
      page: legacyPagination.value.page,
      limit: legacyPagination.value.limit,
      taskClass: taskClass.value,
      state: taskState.value,
      projectId: selectedProjectId.value === "" ? undefined : selectedProjectId.value,
    });
    legacyTaskList.value = data.data;
    legacyPagination.value.total = Number(data.total);
  } catch (error) {
    window.$message.error(errorText(error, $t("workbench.task.fetchFailed")));
  } finally {
    legacyPagination.value.loading = false;
  }
}

async function openLimits() {
  limitDialogVisible.value = true;
  limitsLoading.value = true;
  try {
    const { data } = await axios.post("/generationTasks/limits/list");
    limitRows.value = data.map((row: ProviderLimit) => ({ ...row, key: `${row.provider}:${row.model}:${row.lane}` }));
  } catch (error) {
    window.$message.error(errorText(error, $t("workbench.task.durable.limits.loadFailed")));
  } finally {
    limitsLoading.value = false;
  }
}

function editLimit(row: ProviderLimit) {
  limitForm.value = { ...row };
}

async function saveLimit() {
  if (!limitForm.value.provider.trim()) {
    window.$message.warning($t("workbench.task.durable.limits.providerRequired"));
    return false;
  }
  try {
    await axios.post("/generationTasks/limits/upsert", {
      ...limitForm.value,
      provider: limitForm.value.provider.trim(),
      model: limitForm.value.model.trim() || "*",
    });
    window.$message.success($t("workbench.task.durable.limits.saved"));
    await openLimits();
    return true;
  } catch (error) {
    window.$message.error(errorText(error, $t("workbench.task.durable.limits.saveFailed")));
    return false;
  }
}

async function openBudget() {
  budgetDialogVisible.value = true;
  if (!budgetProjectId.value) budgetProjectId.value = projectOptions.value.find((item) => item.value !== "")?.value || "";
  try {
    const { data } = await axios.post("/generationTasks/limits/pricing/list");
    pricingRules.value = data;
    if (budgetProjectId.value) await loadBudget();
  } catch (error) {
    window.$message.error(errorText(error, "读取预算与价格失败"));
  }
}

async function loadBudget() {
  if (!budgetProjectId.value) return;
  const { data } = await axios.post("/generationTasks/limits/budget/get", { projectId: budgetProjectId.value });
  budgetInfo.value = data;
  budgetForm.value = { budgetLimit: data.budgetLimit ?? undefined, currency: data.currency, blockUnknownPrice: data.blockUnknownPrice };
}

async function saveBudget() {
  if (!budgetProjectId.value) return;
  try {
    const { data } = await axios.post("/generationTasks/limits/budget/upsert", { projectId: budgetProjectId.value, ...budgetForm.value, budgetLimit: budgetForm.value.budgetLimit ?? null });
    budgetInfo.value = data;
    window.$message.success("项目预算已保存");
  } catch (error) {
    window.$message.error(errorText(error, "保存项目预算失败"));
  }
}

function pricingUnitLabel(unit: PricingRule["unitType"]) {
  return pricingUnitOptions.find((item) => item.value === unit)?.label || unit;
}

function editPricingRule(row: PricingRule) {
  pricingForm.value = { ...row };
}

async function savePricingRule() {
  if (!pricingForm.value.provider.trim() || !pricingForm.value.model.trim()) {
    window.$message.warning("供应商和模型不能为空");
    return;
  }
  try {
    await axios.post("/generationTasks/limits/pricing/upsert", pricingForm.value);
    pricingForm.value = emptyPricingForm();
    window.$message.success("价格规则已保存");
    await openBudget();
  } catch (error) {
    window.$message.error(errorText(error, "保存价格规则失败"));
  }
}

async function removePricingRule(row: PricingRule) {
  try {
    await axios.post("/generationTasks/limits/pricing/delete", { id: row.id });
    window.$message.success("价格规则已删除");
    await openBudget();
  } catch (error) {
    window.$message.error(errorText(error, "删除价格规则失败"));
  }
}

function confirmCancel(task: DurableTask) {
  const dialog = DialogPlugin.confirm({
    header: $t("workbench.task.durable.cancelTitle"),
    body: $t("workbench.task.durable.cancelBody"),
    confirmBtn: $t("workbench.task.durable.cancel"),
    cancelBtn: $t("workbench.task.durable.close"),
    theme: "warning",
    onConfirm: async () => {
      actionTaskId.value = task.id;
      try {
        await axios.post("/generationTasks/cancel", { taskId: task.id });
        window.$message.success($t("workbench.task.durable.cancelRequested"));
        dialog.destroy();
        await getDurableTasks();
      } catch (error) {
        window.$message.error(errorText(error, $t("workbench.task.durable.actionFailed")));
      } finally {
        actionTaskId.value = "";
      }
    },
  });
}

function confirmRetry(task: DurableTask) {
  const manualReview = task.status === "manual_review";
  const dialog = DialogPlugin.confirm({
    header: manualReview ? $t("workbench.task.durable.confirmRetryTitle") : $t("workbench.task.durable.retryTitle"),
    body: manualReview ? $t("workbench.task.durable.confirmRetryBody") : $t("workbench.task.durable.retryBody"),
    confirmBtn: manualReview ? $t("workbench.task.durable.confirmRetry") : $t("workbench.task.durable.retry"),
    cancelBtn: $t("workbench.task.durable.close"),
    theme: manualReview ? "danger" : "warning",
    onConfirm: async () => {
      actionTaskId.value = task.id;
      try {
        await axios.post("/generationTasks/retry", {
          taskId: task.id,
          confirmUnknownProviderState: manualReview,
        });
        window.$message.success($t("workbench.task.durable.retryQueued"));
        dialog.destroy();
        await getDurableTasks();
      } catch (error) {
        window.$message.error(errorText(error, $t("workbench.task.durable.actionFailed")));
      } finally {
        actionTaskId.value = "";
      }
    },
  });
}

function statusLabel(status: DurableStatus) {
  return $t(`workbench.task.durable.statuses.${status}`);
}

function statusTheme(status: DurableStatus): "default" | "primary" | "warning" | "danger" | "success" {
  if (status === "succeeded") return "success";
  if (status === "failed" || status === "manual_review") return "danger";
  if (["retry_wait", "blocked", "cancelling"].includes(status)) return "warning";
  if (["claimed", "submitting", "submitted", "polling", "finalizing"].includes(status)) return "primary";
  return "default";
}

function canCancel(status: DurableStatus) {
  return !["cancelled", "succeeded", "failed", "cancelling"].includes(status);
}

function canRetry(status: DurableStatus) {
  return ["failed", "cancelled", "manual_review"].includes(status);
}

function taskTypeLabel(type: string) {
  const labels: Record<string, string> = {
    "video.generate": $t("workbench.task.durable.videoGenerate"),
    "asset.image.generate": $t("workbench.task.durable.assetImageGenerate"),
    "storyboard.image.generate": $t("workbench.task.durable.storyboardImageGenerate"),
    "tts.utterance.generate": $t("workbench.task.durable.utteranceTtsGenerate"),
    "composition.render": "本地视频合成",
    "composition.qa": "媒体 QA",
  };
  return labels[type] || type;
}

function shortId(id: string) {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function formatTime(value: number | null | undefined) {
  return value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "-";
}

function errorText(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return fallback;
}
</script>

<style lang="scss" scoped>
.taskCenter {
  min-width: 0;

  .header {
    padding-top: 32px;
    margin-bottom: 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;

    .title {
      font-size: 32px;
      font-weight: 600;
    }

    .sub {
      opacity: 0.55;
    }
  }

  .headerActions {
    gap: 12px;
  }

  .autoRefreshHint,
  .taskId,
  .providerJobId,
  .noOperation {
    color: var(--td-text-color-placeholder);
    font-size: 12px;
  }

  .filterBar {
    gap: 20px;
    padding: 20px 0;
  }

  .safetyHint {
    margin-bottom: 16px;
  }

  .limitHint {
    margin-bottom: 16px;
  }

  .limitForm {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-bottom: 16px;
  }

  .budgetSummary,
  .pricingForm {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin: 16px 0;
    align-items: end;
  }

  .budgetNumbers {
    display: flex;
    gap: 24px;
    padding: 12px;
    margin-bottom: 18px;
    border-radius: 8px;
    background: var(--td-bg-color-secondarycontainer);
  }

  .switchField { display: flex; flex-direction: column; gap: 8px; font-size: 12px; }

  .sectionTitle { margin: 18px 0 8px; font-size: 16px; font-weight: 600; }

  .taskTypeCell {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .providerJobId,
  .taskId {
    cursor: help;
  }

  .errorMessage {
    display: inline-block;
    max-width: 100%;
    color: var(--td-error-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: help;
  }

  .operations {
    gap: 8px;
  }

  .stateText {
    font-weight: bold;
  }

  .stateFail {
    color: var(--td-error-color);
    cursor: pointer;
  }

  .stateRunning {
    color: var(--td-brand-color);
  }

  .stateSuccess {
    color: var(--td-success-color);
  }

  .paginationWrap {
    margin-top: 16px;
  }
}
</style>
