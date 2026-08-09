const MAX_ACTION_BEATS = 4;
const MAX_ACTION_BEAT_LENGTH = 160;

export const CONFIRMED_ACTION_BEATS_PROMPT_CONTRACT = `
## 已确认动作拍点
当 storyboardItem 的 actionBeats 非空时，它是用户已确认的有序动作/状态变化。动作描述必须按输入顺序覆盖全部拍点，不得跳过、交换或编造 videoDesc 之外的新剧情；可按总时长合理分配节奏。actionBeats 为空时完全沿用原 videoDesc 生成路径。
`;

function parseActionBeatsInput(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];

  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // 兼容人工编辑的逐行文本和历史异常值。
  }
  return trimmed.split(/\r?\n/);
}

export function normalizeActionBeats(value: unknown): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of parseActionBeatsInput(value)) {
    if (typeof raw !== "string") continue;
    const beat = raw
      .replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_ACTION_BEAT_LENGTH);
    if (!beat || seen.has(beat)) continue;
    seen.add(beat);
    result.push(beat);
    if (result.length >= MAX_ACTION_BEATS) break;
  }

  return result;
}

export function serializeActionBeats(value: unknown): string {
  return JSON.stringify(normalizeActionBeats(value));
}

export function isActionBeatsConfirmed(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function stageLabels(count: number): string[] {
  if (count <= 1) return ["action"];
  if (count === 2) return ["trigger", "resolution"];
  if (count === 3) return ["trigger", "peak", "aftermath"];
  return ["setup", "trigger", "peak", "aftermath"];
}

export function formatConfirmedActionBeats(value: unknown, confirmed: unknown): string {
  if (!isActionBeatsConfirmed(confirmed)) return "";
  const beats = normalizeActionBeats(value);
  const labels = stageLabels(beats.length);
  return beats.map((beat, index) => `${labels[index]}: ${beat}`).join(" | ");
}

export function escapeXmlAttribute(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
