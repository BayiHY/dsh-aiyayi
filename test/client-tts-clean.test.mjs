// 朗读清洗（stripMarkdown/cleanForSpeech）+ 消息气泡重听静态守卫测试。
// client.js 是浏览器插件脚本：通过 window.__ModuleLoader__.load 注册 factory，
// 这里用桩 window 接住 factory，再调 exports.__testing 拿纯函数直接测。
// 另有一组源码结构守卫：确保两条朗读路径共用清洗、重听按钮注册要素齐全。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const clientPath = path.join(root, "lib", "client.js");

// ---- 加载插件 factory（浏览器桩） ----
let captured;
globalThis.window = { __ModuleLoader__: { load: (m) => { captured = m; } } };
await import(pathToFileURL(clientPath).href);
assert.ok(captured?.factory, "client.js 应通过 window.__ModuleLoader__.load 注册 factory");

const pluginExports = captured.factory(() => {
	throw new Error("factory 顶层不应 require（本测试只测清洗纯函数）");
});
const { cleanForSpeech, stripMarkdown } = pluginExports.__testing ?? {};
assert.equal(typeof cleanForSpeech, "function", "exports.__testing.cleanForSpeech 应存在");
assert.equal(typeof stripMarkdown, "function", "exports.__testing.stripMarkdown 应存在");

// ---- 清洗用例（任务要求 ≥8 类，逐条对过） ----
test("加粗/斜体记号剥掉只留文字", () => {
	assert.equal(cleanForSpeech("**加粗**内容"), "加粗内容");
	assert.equal(cleanForSpeech("请 *注意* 这里"), "请 注意 这里");
	assert.equal(stripMarkdown("__粗体__与~~删除线~~"), "粗体与删除线");
});

test("单星斜体紧贴中文也剥掉（前导不再只认行首/空白/左括号）", () => {
	assert.equal(cleanForSpeech("这是*斜体*文本"), "这是斜体文本");
	assert.equal(cleanForSpeech("这是*斜体*，后面还有"), "这是斜体，后面还有");
});

test("标题记号剥掉（含无空格 #标题）", () => {
	assert.equal(cleanForSpeech("# 一级标题\n正文"), "一级标题\n正文");
	assert.equal(cleanForSpeech("##二级标题"), "二级标题");
});

test("行内代码去反引号留内容", () => {
	assert.equal(cleanForSpeech("用 `console.log` 打印"), "用 console.log 打印");
});

test("链接只念文字，裸 URL 念『链接』", () => {
	assert.equal(cleanForSpeech("[官网](https://example.com)在这"), "官网在这");
	assert.equal(cleanForSpeech("见 https://a.example/x 结束"), "见 链接 结束");
});

test("列表行首记号去掉只留条目", () => {
	assert.equal(cleanForSpeech("- 甲\n1. 乙\n* 丙"), "甲\n乙\n丙");
});

test("表格：分隔行整行去、数据行去竖线留单元格", () => {
	assert.equal(
		cleanForSpeech("| 名 | 值 |\n| --- | --- |\n| 甲 | 1 |"),
		"名 值\n甲 1",
	);
});

test("纯中文与标点换行零损伤", () => {
	assert.equal(cleanForSpeech("你好，世界。"), "你好，世界。");
	assert.equal(cleanForSpeech("第一句。\n\n第二句？"), "第一句。\n\n第二句？");
});

test("含星号算术不被误伤（2 * 3 / 2 ** 3）", () => {
	assert.equal(cleanForSpeech("算一下 2 * 3 等于几"), "算一下 2 * 3 等于几");
	assert.equal(cleanForSpeech("算 2 ** 3 和 2 * 3 * 4"), "算 2 ** 3 和 2 * 3 * 4");
});

test("围栏代码块整块不念，图片记号去掉", () => {
	assert.equal(cleanForSpeech("前```js\nsecret()\n```后"), "前 后");
	assert.equal(stripMarkdown("![截图](https://x/y.png)看图"), "看图");
});

test("残留孤立反引号去掉，不念反引号本身", () => {
	assert.equal(cleanForSpeech("`孤立标记"), "孤立标记");
});

test("超长文本截断带提示尾", () => {
	const out = cleanForSpeech("甲".repeat(3000));
	assert.ok(out.length < 3000, "超长应截断");
	assert.ok(out.endsWith("……后面还有内容就不念了"), "截断应带提示尾");
});

// ---- 结构守卫：两条朗读路径共用清洗 + 重听按钮注册要素 ----
test("普通朗读与分句流式路径都过 cleanForSpeech（改一处漏一处会被抓）", () => {
	const src = readFileSync(clientPath, "utf8");
	// 定义 1 处 + speak/enqueueSentence/edgeEnqueueSentence 三处调用
	const calls = src.match(/cleanForSpeech\(/g) ?? [];
	assert.ok(calls.length >= 4, `cleanForSpeech 调用点应 ≥4，实际 ${calls.length}`);
	assert.match(src, /function speak\(text\) \{[^}]*const clean = cleanForSpeech\(text\);/);
	assert.match(src, /function enqueueSentence\([^)]*\) \{[^}]*const clean = cleanForSpeech\(text\);/);
	assert.match(src, /function edgeEnqueueSentence\([^)]*\) \{[^}]*const clean = cleanForSpeech\(text\);/);
});

test("重听按钮注册要素齐全（方案A）", () => {
	const src = readFileSync(clientPath, "utf8");
	assert.match(src, /const inject = \["sessions", "slots"\];/, "inject 需补 slots");
	assert.match(src, /id: "dsh-aiyayi\/tts-replay"/, "槽 entry id");
	assert.match(src, /ctx\.slots\.inject\("conversation\.chat\.assistant-actions"/, "槽 inject");
	assert.match(src, /dsh-aiyayi-tts\.played/, "播过登记 localStorage key");
	assert.match(src, /markPlayedIfRead\(streamAttempts/, "default 流式侧播过登记");
	assert.match(src, /markPlayedIfRead\(edgeAttempts/, "edge 流式侧播过登记");
	assert.match(src, /exports\.__testing = \{ cleanForSpeech, stripMarkdown \}/, "测试钩子");
});
