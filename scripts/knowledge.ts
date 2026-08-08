import fs from "node:fs";
import path from "node:path";

interface KnowledgeRelation {
  type: string;
  target: string;
}

interface KnowledgeNode {
  id: string;
  type: string;
  name: string;
  summary: string;
  user_entry?: { page: string; action: string };
  source_paths?: string[];
  api?: string[];
  tables?: string[];
  config?: string[];
  relations?: KnowledgeRelation[];
  troubleshooting?: string[];
  introduced_in: string;
  last_verified_commit: string;
}

interface KnowledgeMap {
  schema_version: number;
  nodes: KnowledgeNode[];
}

const root = process.cwd();
const sourcePath = path.join(root, "docs/knowledge-hub/knowledge-map.yaml");
const outputDir = path.join(root, "docs/knowledge-hub/generated");

function loadMap(): KnowledgeMap {
  return JSON.parse(fs.readFileSync(sourcePath, "utf8")) as KnowledgeMap;
}

function validate(map: KnowledgeMap): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const node of map.nodes) {
    if (ids.has(node.id)) errors.push(`重复节点 ID: ${node.id}`);
    ids.add(node.id);
    if (!node.name || !node.summary || !node.introduced_in || !node.last_verified_commit) {
      errors.push(`节点缺少必填字段: ${node.id}`);
    }
  }
  for (const node of map.nodes) {
    for (const source of node.source_paths ?? []) {
      if (!fs.existsSync(path.join(root, source))) errors.push(`源码路径不存在: ${node.id} -> ${source}`);
    }
    for (const relation of node.relations ?? []) {
      if (!ids.has(relation.target)) errors.push(`关系目标不存在: ${node.id} -> ${relation.target}`);
    }
  }
  return errors;
}

function table(title: string, headers: string[], rows: string[][]): string {
  return `# ${title}\n\n| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |\n${rows
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n")}\n`;
}

function build(map: KnowledgeMap): void {
  fs.mkdirSync(outputDir, { recursive: true });
  const features = map.nodes.filter((node) => node.type === "feature" || node.type === "workflow");
  const routes = map.nodes.flatMap((node) => (node.api ?? []).map((api) => [api, node.name, node.id]));
  const data = map.nodes.flatMap((node) => (node.tables ?? []).map((name) => [name, node.name, node.id]));
  const relations = map.nodes.flatMap((node) => (node.relations ?? []).map((relation) => [node.id, relation.type, relation.target]));
  fs.writeFileSync(
    path.join(outputDir, "feature-index.md"),
    table("功能索引（自动生成）", ["功能", "说明", "节点"], features.map((node) => [node.name, node.summary, node.id])),
  );
  fs.writeFileSync(path.join(outputDir, "route-index.md"), table("接口索引（自动生成）", ["接口", "功能", "节点"], routes));
  fs.writeFileSync(path.join(outputDir, "data-index.md"), table("数据索引（自动生成）", ["表", "功能", "节点"], data));
  fs.writeFileSync(path.join(outputDir, "relation-map.md"), table("关系图（自动生成）", ["来源", "关系", "目标"], relations));
}

const command = process.argv[2] ?? "check";
const map = loadMap();
const errors = validate(map);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else if (command === "build") {
  build(map);
  console.log(`知识索引已生成，共 ${map.nodes.length} 个节点`);
} else {
  console.log(`知识地图校验通过，共 ${map.nodes.length} 个节点`);
}
