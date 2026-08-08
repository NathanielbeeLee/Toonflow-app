export type UtteranceKind = "dialogue" | "narration" | "chorus";

export interface ParsedUtterance {
  ordinal: number;
  kind: UtteranceKind;
  speaker: string;
  text: string;
  roleAssetId: number | null;
}

const narrationLabels = new Set(["旁白", "画外音", "解说", "叙述", "narrator"]);
const chorusLabels = new Set(["群声", "众人", "所有人", "合声", "chorus"]);

function normalizeLabel(value: string): string {
  return value.trim().replace(/^\[|\]$/g, "").toLocaleLowerCase();
}

function classifySpeaker(speaker: string): UtteranceKind {
  const normalized = normalizeLabel(speaker);
  if (narrationLabels.has(normalized)) return "narration";
  if (chorusLabels.has(normalized)) return "chorus";
  return "dialogue";
}

function cleanLine(value: string): string {
  return value.trim().replace(/^[-*]\s+/, "").trim();
}

export function parseDialogue(
  content: string,
  roleAssets: Array<{ id: number; name: string }>,
): ParsedUtterance[] {
  const roleByName = new Map(roleAssets.map((asset) => [normalizeLabel(asset.name), asset.id]));
  const parsed: Omit<ParsedUtterance, "ordinal">[] = [];

  for (const rawLine of content.replace(/\r\n?/g, "\n").split("\n")) {
    const line = cleanLine(rawLine);
    if (!line || /^#{1,6}\s/.test(line)) continue;
    const match = line.match(/^([^：:]{1,32})[：:]\s*(.+)$/);
    if (match) {
      const speaker = match[1].trim();
      const text = match[2].trim();
      if (!text) continue;
      const kind = classifySpeaker(speaker);
      parsed.push({
        kind,
        speaker: kind === "narration" ? "旁白" : kind === "chorus" ? "群声" : speaker,
        text,
        roleAssetId: kind === "dialogue" ? roleByName.get(normalizeLabel(speaker)) ?? null : null,
      });
      continue;
    }

    const previous = parsed.at(-1);
    if (previous && previous.kind !== "narration") {
      previous.text = `${previous.text}\n${line}`;
    } else {
      parsed.push({ kind: "narration", speaker: "旁白", text: line, roleAssetId: null });
    }
  }

  return parsed.map((item, ordinal) => ({ ...item, ordinal }));
}

export function formatSubtitleTime(milliseconds: number, separator: "," | "."): string {
  const safe = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const millis = safe % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
}

export function serializeSubtitles(
  cues: Array<{ startMs: number; endMs: number; text: string }>,
  format: "srt" | "vtt",
): string {
  const body = cues
    .map((cue, index) => {
      const separator = format === "srt" ? "," : ".";
      const timing = `${formatSubtitleTime(cue.startMs, separator)} --> ${formatSubtitleTime(cue.endMs, separator)}`;
      return format === "srt" ? `${index + 1}\n${timing}\n${cue.text}` : `${timing}\n${cue.text}`;
    })
    .join("\n\n");
  return format === "vtt" ? `WEBVTT\n\n${body}\n` : `${body}\n`;
}
