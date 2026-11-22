// 校验 cordis.patch.yml：YAML 语法 + 结构断言 + 私货/红线扫描（git diff 新增行）
// 用法：node test/preset-yaml-verify.mjs [--file <yml 路径>] [--repo <仓库根>]
//   缺省：本仓库根下的 cordis.patch.yml；扫描基准 = 该仓库 git 工作区 diff 的新增行。
// 私货/红线词表是"新增文本 0 命中"发版验收的一部分：新增预设/人格文本里不得出现
// 真名、旧称呼、私人路径/项目、发版方私有工具名、记忆同步类机制描述、会话语义工具名
// （记忆/日程/状态属于会话主人的职责面，不该出现在执行预设的提示词里）。
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
};
const repoDir = resolve(argOf('--repo') || join(here, '..'));
const file = resolve(argOf('--file') || join(repoDir, 'cordis.patch.yml'));
const raw = readFileSync(file, 'utf8');

// js-yaml 优先从本包依赖取，取不到再退宿主安装目录（DSH 桌面版 shipped 布局）
const requireFrom = createRequire(join(repoDir, 'package.json'));
let yaml;
try {
  yaml = requireFrom('js-yaml');
} catch {
  const os = await import('node:os');
  yaml = createRequire(join(os.homedir(), String.raw`.dsh\debug-asar\app\package.json`))('js-yaml');
}

// 宿主自定义 !!js 标签（布尔禁用表达式）：构造占位串，只为过语法与结构校验
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: () => true,
  construct: (s) => `!!js:${s}`,
});
const schema = yaml.DEFAULT_SCHEMA.extend({ explicit: [JsExpr] });

// 1) YAML 语法
let doc;
try {
  doc = yaml.load(raw, { schema });
  console.log('[1] YAML parse: OK');
} catch (e) {
  console.error('[1] YAML parse FAILED:', e.message);
  process.exit(1);
}

// 2) 结构断言
const inserts = doc[0].insert;
const presetIds = inserts.map((p) => p.config && p.config.id);
console.log('[2] insert presets:', JSON.stringify(presetIds));
const mustPresets = String(argOf('--presets') || 'aiyayi,aiyayi-worker,aiyayi-retriever,aiyayi-bag').split(',');
for (const must of mustPresets) {
  if (!presetIds.includes(must)) { console.error('MISSING preset:', must); process.exit(1); }
}
console.log('[2] all declared presets present: OK');

// 每个 preset 的 persona 与委派实例普查（bag 类叶子预设必须无委派组）
for (const pid of presetIds) {
  const preset = inserts.find((p) => p.config.id === pid);
  const pluginIds = (preset.config.plugins || []).map((p) => p.id);
  const hasDelegation = pluginIds.includes('delegation');
  const persona = preset.config.plugins.find((p) => p.id === 'persona');
  console.log(`[2] ${pid}: plugins=[${pluginIds.join(',')}] delegation=${hasDelegation} persona=${persona ? 'yes' : 'no'}`);
  if (!persona) { console.error(`${pid}: persona missing`); process.exit(1); }
  if (!hasDelegation) continue;
  const deleg = preset.config.plugins.find((p) => p.id === 'delegation');
  const subs = deleg.config.filter((c) => c.name === '@deepseek-ai/dsh-tool-subagent');
  console.log(`[2] ${pid} tool-subagent instances: ${subs.map((c) => c.config.toolName).join(',')}`);
  const names = subs.map((c) => c.config.toolName);
  if (new Set(names).size !== names.length) { console.error(`${pid}: duplicate toolName in delegation group`); process.exit(1); }
}
console.log('[2] preset structure: OK');

// 3) 私货/红线扫描——验收口径 = git 工作区 diff 的新增行 0 命中
let addedLines = '';
try {
  addedLines = execFileSync('git', ['-c', 'core.quotepath=false', 'diff', '-U0', '--', 'cordis.patch.yml'], {
    cwd: repoDir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
} catch (e) {
  console.error('[3] git diff failed:', e.message);
  process.exit(1);
}
const added = addedLines.split('\n')
  .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
  .map((l) => l.slice(1));
console.log(`[3] diff 新增行数: ${added.length}`);

// HEAD 基线全文：红线词表里"会话语义词/工具面词/同步"等在本体 persona 里本来就有
// （如"保留口子"行），拆行改动会被 git 行级 diff 整行算作新增。这些词不是本次新
// 引入的私货，按同一条正则在整个 HEAD 文本上匹配到就豁免；只抓 HEAD 里没出现、
// 却在本次新增行里出现的词。
let headText = '';
try {
  headText = execFileSync('git', ['show', 'HEAD:cordis.patch.yml'], {
    cwd: repoDir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
} catch (e) {
  console.error('[3] git show HEAD:cordis.patch.yml failed:', e.message);
  process.exit(1);
}

// 红线词表（按需增删）：人名/称呼/路径/项目/私有工具/机制/会话语义工具
const RED = [
  ['真名', /李浩/],
  ['旧称呼', /娅依(?!（)/],
  ['私人路径-记忆盘', /阿依娅伊\\记忆|阿依娅伊\\\\记忆/],
  ['私人路径-源码盘', /TRAE_PRO/],
  ['私人路径-sdcard', /sdcard/],
  ['私人项目-补天', /补天/],
  ['私人项目-DataPhin', /DataPhin/i],
  ['私人项目-astock', /astock/i],
  ['私人项目-eDiary', /eDiary/i],
  ['私有工具-watch_read', /watch_read/],
  ['私有工具-pkg_stats', /pkg_stats/],
  ['私有工具-mem_sync', /mem_sync/],
  ['案例-README漂移', /README 漂移|README漂移/],
  ['红线-同步', /同步/],
  ['红线-上云', /上云|云端/],
  ['红线-git', /\bgit\b|\.gitignore/],
  ['红线-备份', /备份/],
  ['红线-云同步/云盘', /云同步|云盘/],
  ['记忆同步机制', /memPush|远端/],
  ['记忆工具面', /remember|forget|memory_organize|recall/],
  ['会话语义-schedule', /schedule/],
  ['会话语义-wish', /wish/],
  ['会话语义-update_state', /update_state/],
];
let hits = 0;
for (const [label, re] of RED) {
  for (let i = 0; i < added.length; i++) {
    const m = added[i].match(re);
    if (!m) continue;
    if (headText.match(re)) continue; // 该词 HEAD 里已存在 = 非本次新引入，豁免
    hits++;
    console.log(`  [3] HIT 新增行#${i + 1} :: ${label} :: "${m[0]}" :: ${added[i].trim().slice(0, 110)}`);
  }
}
console.log(hits === 0 ? '[3] 新增文本私货/红线扫描: 0 命中 ✅' : `[3] 新增文本私货/红线扫描: ${hits} 命中 ❌`);
process.exit(hits === 0 ? 0 : 2);
