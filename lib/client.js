// 阿依娅伊 Web 客户端插件：新消息自动朗读（TTS）。
// 服务端半边为空（与本仓其他纯客户端面一致），浏览器半边通过 exports["./client"]
// 被 DSH 客户端模块系统发现：package.json 声明 dsh.client 后，本文件在页面里
// 以 window.__ModuleLoader__.load 形式注册，apply(ctx) 拿到客户端根上下文。
//
// V1 行为：
// - 聊天页右侧浮动一个 🔊/🔇 开关，状态记在 localStorage。
// - 开启时订阅各会话事件流，遇到"助手最终回复落定"（assistant/message 且
//   surfaceOp=append、非 interrupted）就整条朗读，不逐字流式、不念工具过程。
// - 朗读前清洗 markdown（代码块/图片/链接/表格分隔符等），优先挑中文 voice。
// - 朗读清洗强化（未发布）：**加粗**/__粗体__/~~删除线~~/无空格 `#标题`/列表 `- ` `1. `/
//   孤立反引号统一在 stripMarkdown 剥掉（显示不受影响），星号算术（2 * 3）不误伤；
//   普通朗读与分句流式两条路径共用同一道 stripMarkdown→cleanForSpeech。
// - 消息气泡重听喇叭（未发布 · 方案A）：注册官方槽 conversation.chat.assistant-actions，
//   每轮助手回复 turn 尾行一个 🔊，点一下朗读该条、播放中再点停止；播过登记
//   localStorage dsh-aiyayi-tts.played，播过的按钮高亮（详见下方"消息气泡重听"region）。
// - 新消息到来先 cancel 上一条，避免叠音；rate 1.1 稍快。
// - 哑窗口降级（1.17.0）：页面没有 window.speechSynthesis（或其 speak 不可用）
//   时，开关按钮仍然渲染但置灰、样式呈禁用态；点击改为向引擎要一个带认证的
//   完整 URL（GET /api/aiyayi/auth-url，登录态栅栏后的 exact fetch 路由），
//   复制到剪贴板并用弹窗提示正路（用 Chrome / Edge / Firefox 打开即可自动
//   朗读）；剪贴板不可用时降级为 prompt 手动复制，接口失败弹失败说明。
//   朗读全链路不启动。支持时行为完全不变。
// - edge-tts 桥（1.19.0）：localStorage["dsh-aiyayi-tts.engine"] === "edge" 时，
//   朗读文本转投本地合成服务（http://127.0.0.1:52123/tts，微软在线神经音色
//   zh-CN-XiaoxiaoNeural 晓晓），音频流直接交给 <audio> 播放（1.20.1 起 src
//   直指桥 URL 边下边播，兼容旧「攒齐整段再返回」的桥），不依赖 speechSynthesis；
//   服务不在/失败时静默回退无声，不炸页面。未设或其余值 = 原 Web Speech 逻辑。
//   桥地址可用 localStorage["dsh-aiyayi-tts.endpoint"] 覆盖（1.20.0 起），默认 127.0.0.1:52123。

window.__ModuleLoader__?.load({
	id: "dsh-aiyayi",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const NS = "aiyayi-tts";
		const STORE_KEY = "dsh-aiyayi-tts.enabled";
		const MAX_SPEAK_CHARS = 2000;
		// 1.19.0 edge-tts 桥：engine 开关切朗读后端。'edge' 走本地合成服务
		// （G:\阿依娅伊\tools\edge_tts_server.py，127.0.0.1:52123，微软晓晓
		// zh-CN-XiaoxiaoNeural）；其余/未设 = 'default'，原 speechSynthesis 兜底。
		const ENGINE_KEY = "dsh-aiyayi-tts.engine";
		const DEFAULT_EDGE_TTS_ENDPOINT = "http://127.0.0.1:52123/tts";
		const ENDPOINT_KEY = "dsh-aiyayi-tts.endpoint";
		const EDGE_TTS_RATE = "+10%"; // 原 rate 1.1 的 edge-tts 口径近似

		//#region 开关状态
		function readEnabled() {
			try {
				return localStorage.getItem(STORE_KEY) === "1";
			} catch {
				return false;
			}
		}
		function writeEnabled(value) {
			try {
				localStorage.setItem(STORE_KEY, value ? "1" : "0");
			} catch {}
		}
		let enabled = readEnabled();

		/** 当前朗读引擎：localStorage[ENGINE_KEY] === 'edge' 时走 edge-tts 桥，否则 default。 */
		function readEngine() {
			try {
				return localStorage.getItem(ENGINE_KEY) === "edge" ? "edge" : "default";
			} catch {
				return "default";
			}
		}
		/** 当前 edge-tts 桥地址：localStorage[ENDPOINT_KEY] 可覆盖，空值/异常回落默认（127.0.0.1:52123）。 */
		function readEndpoint() {
			try {
				return localStorage.getItem(ENDPOINT_KEY)?.trim() || DEFAULT_EDGE_TTS_ENDPOINT;
			} catch {
				return DEFAULT_EDGE_TTS_ENDPOINT;
			}
		}
		//#endregion

		//#region 文本清洗：把 markdown/URL 清成适合念出来的话
		/**
		 * 纯文本剥离 markdown 记号（不动标点与换行语义、中文零损伤），只留可念正文。
		 * 覆盖：``` 围栏（成对/未闭合整块去）、图片、链接 [文字](url) 只留文字、
		 * 裸 URL 念"链接"、行内代码与残留反引号、表格分隔行整行去/数据行去管道留单元格、
		 * 标题 #（含无空格的 #标题）、引用 >、加粗（**）、粗体（__）、删除线（~~）、
		 * 单星斜体、列表行首 `- ` / `* ` / `+ ` / `1. ` / `1) ` 记号。
		 * 星号算术不受影响："2 * 3"（星号后是空格起不了斜体对）、"2 ** 3"（只有一对
		 * ** 成不了 **粗** 对）都不动。
		 * @param raw - 原始 markdown 文本。
		 * @returns 剥完记号的纯文本（未做空白合并与截断）。
		 */
		function stripMarkdown(raw) {
			let text = String(raw ?? "");
			// 围栏代码块整块去掉
			text = text.replace(/```[\s\S]*?(?:```|$)/g, " ");
			// 图片 ![alt](url) 去掉
			text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
			// 链接 [text](url) 只留文字
			text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
			// 裸 URL 只念"链接"
			text = text.replace(/https?:\/\/\S+/g, "链接");
			// 行内代码去反引号留内容
			text = text.replace(/`([^`]*)`/g, "$1");
			// 表格：分隔行整行去掉，数据行去竖线留单元格文字
			text = text.split("\n").filter((line) => !/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line)).map((line) => line.replace(/\s*\|\s*/g, " ").trim()).join("\n");
			// 标题（#标题 无空格也算，行首 0-3 空格内）、引用
			text = text.replace(/^[ \t]{0,3}#{1,6}[ \t]*/gm, "");
			text = text.replace(/^\s{0,3}>\s?/gm, "");
			// 加粗/斜体/下划线粗体/删除线：只剥成对且边界合法的
			text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
			// 单星斜体：前导用负向断言排除 ASCII 单词字符（同 __粗体__ 口径），
			// 中文/标点/括号后紧贴的 *斜体* 也能剥；星号后仍须非空白，2 * 3 不误伤。
			text = text.replace(/(?<!\w)\*([^*\s][^*]*)\*/g, "$1");
			// __粗体__：两侧不贴 ASCII 单词字符（防误伤 snake_case 标识符）；
			// 中文不在 \w 里，"说__粗__话" 照剥
			text = text.replace(/(?<![\w])__([^_]+)__(?![\w])/g, "$1");
			text = text.replace(/~~([^~]+)~~/g, "$1");
			// 列表行首记号：- / * / + / 1. / 1) 去掉只留条目文字
			text = text.replace(/^[ \t]{0,3}(?:[-+*]|\d{1,3}[.)])[ \t]+/gm, "");
			// 残留的孤立反引号（不成对记号）去掉，别念"反引号"
			text = text.replace(/`/g, "");
			return text;
		}
		/** 朗读出口：剥 markdown + 合并空白 + 超长截断。两条朗读路径（整条/分句流式）共用。 */
		function cleanForSpeech(raw) {
			let text = stripMarkdown(raw);
			// 合并空白，截断超长
			text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
			if (text.length > MAX_SPEAK_CHARS) text = `${text.slice(0, MAX_SPEAK_CHARS)}……后面还有内容就不念了`;
			return text;
		}
		//#endregion

		//#region 语音
		// 能力检测（1.17.0）：内嵌 WebView（如 DSH-Go App 窗口）常无 speechSynthesis，
		// 直接打开会"点了开关也没声"。检测口径：对象不存在，或 speak 不是函数，都算不支持。
		// 1.19.0：engine=edge 时走本地 edge-tts 服务，不依赖 speechSynthesis，也算支持。
		const hasWebSpeech = typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined" && typeof window.speechSynthesis?.speak === "function";
		const ttsSupported = () => hasWebSpeech || readEngine() === "edge";
		let cachedVoice;
		if (typeof window !== "undefined" && window.speechSynthesis?.addEventListener) {
			window.speechSynthesis.addEventListener("voiceschanged", () => {
				cachedVoice = undefined;
			});
		}
		/** 优先挑中文 voice：lang 精确 zh-CN > 任意 zh > 系统默认。 */
		function pickVoice() {
			if (cachedVoice !== undefined) return cachedVoice;
			const synth = window.speechSynthesis;
			if (!synth?.getVoices) return undefined;
			const voices = synth.getVoices();
			const zh = voices.filter((voice) => (voice.lang || "").toLowerCase().startsWith("zh"));
			cachedVoice = zh.find((voice) => (voice.lang || "").toLowerCase() === "zh-cn") ?? zh[0];
			return cachedVoice;
		}
		//#endregion

		//#region 流式分段朗读（系统 TTS 专用，仅 engine=default 时启用）
		// 目标：助手文字还在流式吐出时，凑够一句就念（句号/问号/叹号/换行等边界），
		// 句子直接预喂进浏览器 speechSynthesis 内部队列无缝衔接；控制条=暂停/继续+清空。
		// 不动 edge 分支、不动 durable 整条朗读。
		// 触发源：宿主在同一 eventSource 发 transient assistant/live-chunk，
		//   entry.type === 'transient'，event.type === 'assistant/live-chunk'，
		//   event.seq 是小数（单调增），data = { attemptId, turn, step, chunk }，
		//   chunk.type === 'text-delta' 的 chunk.text 才是增量文本（reasoning-delta 跳过）。
		// 防重：eventSource 重建/重连会 replay 已消费 chunk 前缀，按 attemptId 记
		//   maxSeq（live-chunk 的 seq 单调增），seq 不增的 replay 一律不补读。
		// 句间停顿修复（2026-11-26）：只在句号/问号/叹号/换行切句；逗号/顿号/分号不切，
		// 避免把一句话剁成多段、每段之间都冒出 Android Chrome 的 utterance 间隙（听感"顿"）。
		// 超长句才按长度兜底切开，避免超长 utterance。
		const STREAM_SENTENCE_MAX = 220;      // 超长兜底阈值（字数）
		const STREAM_PUNCT = /[。！？!?\n]/;  // 句子边界：句号/问号/叹号/换行（逗号等不切）

		// 预喂模型（2026-11-26 二次修复）：不再等前一句 onend 才 speak 下一句——应用层
		// 逐句衔接在 Android Chrome 上每次 speak() 之间都有固有空拍。改为"句子凑成就
		// synth.speak() 投进浏览器内部 utterance 队列"，由浏览器自己无缝衔接，远快于
		// 应用层回调链。onend/onerror 退化为 in-flight 记账（控制条显示/清空用），
		// 不再是 speak 的触发器。句子未凑成不会喂（文字还没到，这是唯一天然窗口）。
		// 代价：进浏览器队列后无法单独撤回，"跳过当前句"已移除（见控制条）。
		const inFlight = new Set();         // 已喂进浏览器队列、尚未 onend/onerror 的 utterance
		let currentToken = 0;               // 每次 feed 递增，仅给 utterance 打标（记账用）
		let pausedByUser = false;

		/** 当前是否该走流式系统 TTS（开关开 + default 引擎 + 浏览器支持 Web Speech）。 */
		function streamActive() {
			return enabled && readEngine() === "default" && hasWebSpeech;
		}
		/** 是否还有已喂进浏览器队列、未念完的句子（供控制条显示）。 */
		function streamBusy() {
			return inFlight.size > 0;
		}
		/** 一句播完/失败：只做 in-flight 记账，不再触发下一句 speak（下一句早就预喂进浏览器队列了）。 */
		function noteOneDone(utterance) {
			inFlight.delete(utterance);
			refreshControlBar();
		}
		/**
		 * 把一句直接喂进浏览器 speechSynthesis 内部队列（预喂核心）。
		 * 不等前一句 onend——浏览器自己按顺序无缝衔接，消掉应用层衔接的空拍。
		 * Android Chrome 连续 speak 偶发"排队不播"：speak 后若 synth 既不 speaking 也不
		 * pending，用一次无副作用的 resume() 轻踢（resume 不清队列、不丢句），不 cancel。
		 */
		function feedUtterance(clean) {
			const synth = window.speechSynthesis;
			if (!synth || !clean) return;
			const utterance = new SpeechSynthesisUtterance(clean);
			const voice = pickVoice();
			if (voice) utterance.voice = voice;
			utterance.lang = voice?.lang || "zh-CN";
			utterance.rate = 1.1;
			utterance.onend = () => noteOneDone(utterance);
			utterance.onerror = () => noteOneDone(utterance);
			inFlight.add(utterance);
			synth.speak(utterance);
			currentToken++;
			refreshControlBar();
			// 轻 kick：仅当 speak 之后引擎完全没进入 speaking/pending（疑似老坑"排队不播"），
			// resume() 不会清空已排队句子；延迟一拍让引擎先有机会自己进入状态。
			setTimeout(() => {
				if (!synth.speaking && !synth.pending && inFlight.has(utterance)) {
					try { synth.resume(); } catch {}
				}
			}, 250);
		}
		/** 句子凑成就预喂一句（唯一窗口=句子还没凑成时文字没到，不喂）。 */
		function enqueueSentence(text, attemptId) {
			const clean = cleanForSpeech(text);
			if (!clean) return false;
			feedUtterance(clean);
			return true;
		}

		// 每个 attempt 的流式累积状态：未成句的原文缓冲 + 围栏状态（各实例独立）。
		// key = attemptId；turn/step 仅用于给无 attemptId 的 durable 落定配对。
		const streamAttempts = new Map(); // attemptId -> { buffer, fenced, turn, step, flushed, attemptId }
		// 已消费 chunk 的 maxSeq 水位挂 window 共享：热换装后可能并存两个 client 实例、
		// 各自订阅同一 eventSource，共享水位让第二个实例的 chunk seq ≤ maxSeq 被挡掉，
		// 不会双读（同 1.20.1 edge dedupState 口径）。buffer/队列各实例独立，避免交错撕裂。
		const sharedStreamSeq = (() => {
			if (typeof window === "undefined") return new Map();
			return (window.__aiyayiTtsStreamSeq ??= new Map());
		})(); // attemptId -> maxSeq
		function attemptState(attemptId, turn, step) {
			let st = streamAttempts.get(attemptId);
			if (!st) {
				st = { attemptId, buffer: "", fenced: false, turn, step, flushed: false, fed: false };
				streamAttempts.set(attemptId, st);
			}
			return st;
		}
		/** 从 st.buffer 里切出完整句入队；force=true 时把残余尾巴也念掉（落定 flush）。 */
		function drainSentences(st, force) {
			let cut = 0;          // 已入队部分从这里之前移除
			let sentenceStart = 0;// 当前待切句的起点（围栏内的字符也推进它，避免围栏后边界丢失）
			for (let i = 0; i < st.buffer.length; i++) {
				const ch = st.buffer[i];
				if (ch === "`" && st.buffer.slice(i, i + 3) === "```") {
					st.fenced = !st.fenced; // ``` 切换围栏；行内单反引号忽略
					if (st.fenced) sentenceStart = i + 3; // 进围栏：丢弃围栏前残留的空白/半句
					else sentenceStart = i + 3;           // 出围栏：从围栏后重新起句
					i += 2;
					continue;
				}
				if (st.fenced) {
					sentenceStart = i + 1; // 围栏内容不读，但也别让它撑长后面的句子
					continue;
				}
				const seg = st.buffer.slice(sentenceStart, i + 1);
				let isBoundary = STREAM_PUNCT.test(ch);
				if (!isBoundary && seg.length >= STREAM_SENTENCE_MAX) isBoundary = true; // 超长兜底（逗号不再切）
				if (isBoundary) {
					const sentence = seg.replace(/^[，,、：:\s]+/, "").trim();
					sentenceStart = i + 1;
					if (sentence) { if (enqueueSentence(sentence, st.attemptId)) st.fed = true; cut = i + 1; }
				}
			}
			if (cut > 0) st.buffer = st.buffer.slice(cut);
			if (force && st.buffer.trim()) {
				const tail = st.buffer.replace(/^[，,、：:\s]+/, "").trim();
				st.buffer = "";
				if (tail && enqueueSentence(tail, st.attemptId)) st.fed = true;
			}
		}
		/** 收到一个 text-delta：累积、按句切开、入队；重放前缀只缓冲不补读。 */
		function onStreamDelta(attemptId, turn, step, seq, text) {
			if (!streamActive() || typeof text !== "string" || !text) return;
			const st = attemptState(attemptId, turn, step);
			const lastSeq = sharedStreamSeq.get(attemptId) ?? -Infinity;
			if (typeof seq === "number") {
				if (seq <= lastSeq) return; // 重连 replay / 第二实例：不补读、不双读
				sharedStreamSeq.set(attemptId, seq);
			}
			// 围栏内的 delta 也要累积（为了跟踪 ``` 切换），但 drainSentences 会跳过。
			st.buffer += text;
			drainSentences(st, false);
		}
		/** 落定时把残余尾巴 flush 进队列（interrupted/abandoned/committed 都调）。 */
		function flushAttempt(attemptId) {
			const st = streamAttempts.get(attemptId);
			if (!st) return;
			drainSentences(st, true);
			st.buffer = "";
		}
		/** 按 turn/step 找最近一个未 flush 的 attempt（durable committed 无 attemptId 时用）。 */
		function findAttemptByTurn(turn, step) {
			let found;
			for (const [id, st] of streamAttempts) {
				if (st.turn === turn && st.step === step && (st.buffer || !st.flushed)) found = id;
			}
			return found;
		}
		/** 从 durable assistant/message 提取纯文本（含 interrupted 的安全前缀）。 */
		function durableMessageText(event) {
			if (event?.type !== "assistant/message" || event.surfaceOp !== "append") return undefined;
			const content = event.data?.message?.content;
			if (typeof content === "string") return content;
			if (!Array.isArray(content)) return undefined;
			return content.filter((b) => (b?.type === "text" || b?.kind === "text") && typeof b.text === "string").map((b) => b.text).join("");
		}
		/** 订阅一个会话的流式 live-chunk（与 durable 订阅并行，互不干扰）。 */
		const streamWiredSessions = new WeakSet();
		function wireStreamSession(sessionId, eventSource) {
			if (streamWiredSessions.has(eventSource)) return;
			streamWiredSessions.add(eventSource);
			// 初次接线：把当前窗口里 live-chunk 的最高 seq 记为水位，历史 chunk 不念
			// （baseline 重建时的 replay 同样靠共享 maxSeq 水位挡掉）。
			for (const entry of eventSource.getSnapshot().entries) {
				if (entry?.type === "transient" && entry.event?.type === "assistant/live-chunk") {
					const d = entry.event.data ?? {};
					if (d.attemptId && typeof entry.event.seq === "number") {
						const lastSeq = sharedStreamSeq.get(d.attemptId) ?? -Infinity;
						if (entry.event.seq > lastSeq) sharedStreamSeq.set(d.attemptId, entry.event.seq);
					}
				}
			}
			eventSource.subscribe(() => {
				if (!streamActive()) return;
				const change = eventSource.getSnapshot().change;
				if (!change) return;
				// 全量扫 snapshot.entries：settle-assistant 的 change.entries 不含 durable entry，
				// 而 append 的 live-chunk 同时在 change.entries；全量+seq 水位最稳。
				const entries = eventSource.getSnapshot().entries;
				for (const entry of entries) {
					const ev = entry?.event;
					if (!ev) continue;
					// live-chunk：只认 text-delta（settle 后同 attempt 的 transient 已被移除，无需在此处理）
					if (entry.type === "transient" && ev.type === "assistant/live-chunk") {
						const d = ev.data ?? {};
						if (d.chunk?.type === "text-delta" && d.attemptId) {
							onStreamDelta(d.attemptId, d.turn, d.step, ev.seq, d.chunk.text);
						}
					}
				}
				// durable 落定：committed 的 assistant/message（无 attemptId），flush 尾巴
				if (change.kind === "append") {
					for (const entry of change.entries ?? []) {
						const ev = entry?.event;
						const text = durableMessageText(ev);
						if (text === undefined) continue;
						const id = findAttemptByTurn(ev.data?.turn, ev.data?.step);
						if (id) {
							flushAttempt(id);
							streamAttempts.get(id).flushed = true;
						}
						// 播过登记：该 turn 的 attempt 真喂过句子（含刚 flush 的尾巴）才登记
						markPlayedIfRead(streamAttempts, ev.data?.turn, ev.data?.step, ev.data?.message?.id);
					}
				}
				// settle-assistant：change 自带 attemptId，直接收尾（abandoned/interrupted 的尾巴）
				// transient 已被移除、durable 落定无 attemptId，所以不能靠 entry 循环匹配。
				if (change.kind === "settle-assistant" && change.attemptId) {
					flushAttempt(change.attemptId);
					const st = streamAttempts.get(change.attemptId);
					if (st) st.flushed = true;
				}
			});
		}

		//#region edge 分句骨架（1.21.0）：复制系统 TTS 那套结构，消费端换成 edge 播放队列
		// 切分规则（STREAM_PUNCT / STREAM_SENTENCE_MAX）与 cleanForSpeech 共用同一份，
		// 避免两份规则漂移；attempt 状态、window 水位、订阅各自独立（互不干扰、系统 TTS 一行不改）。
		const edgeAttempts = new Map(); // attemptId -> { buffer, fenced, turn, step, flushed, attemptId }
		const sharedEdgeStreamSeq = (() => {
			if (typeof window === "undefined") return new Map();
			return (window.__aiyayiTtsEdgeStreamSeq ??= new Map());
		})(); // attemptId -> maxSeq（独立水位，系统 TTS 用 __aiyayiTtsStreamSeq）
		function edgeAttemptState(attemptId, turn, step) {
			let st = edgeAttempts.get(attemptId);
			if (!st) {
				st = { attemptId, buffer: "", fenced: false, turn, step, flushed: false, fed: false };
				edgeAttempts.set(attemptId, st);
			}
			return st;
		}
		/** 同文本短时间去重（保住 edge 既有 2s 去重口径，防热换装双实例重复喂） */
		function edgeDedupText(text) {
			const last = dedupState();
			const now = Date.now();
			if (text === last.edgeSentenceText && now - last.edgeSentenceAt < 2000) return true;
			last.edgeSentenceText = text;
			last.edgeSentenceAt = now;
			return false;
		}
		/** edge 分句消费端：cleanForSpeech 后走 edge 播放队列（带去重）。返回是否真的喂了（去重跳过时同文本 2s 内刚被读过，也算读过）。 */
		function edgeEnqueueSentence(text) {
			const clean = cleanForSpeech(text);
			if (!clean) return false;
			if (edgeDedupText(clean)) return true;
			enqueueEdgeSentence(clean);
			return true;
		}
		/** 从 st.buffer 切完整句喂 edge；与系统 TTS drainSentences 同规则。 */
		function edgeDrainSentences(st, force) {
			let cut = 0, sentenceStart = 0;
			for (let i = 0; i < st.buffer.length; i++) {
				const ch = st.buffer[i];
				if (ch === "`" && st.buffer.slice(i, i + 3) === "```") {
					st.fenced = !st.fenced;
					sentenceStart = i + 3;
					i += 2;
					continue;
				}
				if (st.fenced) { sentenceStart = i + 1; continue; }
				const seg = st.buffer.slice(sentenceStart, i + 1);
				let isBoundary = STREAM_PUNCT.test(ch);
				if (!isBoundary && seg.length >= STREAM_SENTENCE_MAX) isBoundary = true;
				if (isBoundary) {
					const sentence = seg.replace(/^[，,、：:\s]+/, "").trim();
					sentenceStart = i + 1;
					if (sentence) { if (edgeEnqueueSentence(sentence)) st.fed = true; cut = i + 1; }
				}
			}
			if (cut > 0) st.buffer = st.buffer.slice(cut);
			if (force && st.buffer.trim()) {
				const tail = st.buffer.replace(/^[，,、：:\s]+/, "").trim();
				st.buffer = "";
				if (tail && edgeEnqueueSentence(tail)) st.fed = true;
			}
		}
		function edgeOnDelta(attemptId, turn, step, seq, text) {
			if (typeof text !== "string" || !text) return;
			const st = edgeAttemptState(attemptId, turn, step);
			const lastSeq = sharedEdgeStreamSeq.get(attemptId) ?? -Infinity;
			if (typeof seq === "number") {
				if (seq <= lastSeq) return;
				sharedEdgeStreamSeq.set(attemptId, seq);
			}
			st.buffer += text;
			edgeDrainSentences(st, false);
		}
		function edgeFlushAttempt(attemptId) {
			const st = edgeAttempts.get(attemptId);
			if (!st) return;
			edgeDrainSentences(st, true);
			st.buffer = "";
		}
		function edgeFindAttemptByTurn(turn, step) {
			let found;
			for (const [id, st] of edgeAttempts) {
				if (st.turn === turn && st.step === step && (st.buffer || !st.flushed)) found = id;
			}
			return found;
		}
		const edgeWiredSessions = new WeakSet();
		function edgeWireStreamSession(sessionId, eventSource) {
			if (edgeWiredSessions.has(eventSource)) return;
			edgeWiredSessions.add(eventSource);
			for (const entry of eventSource.getSnapshot().entries) {
				if (entry?.type === "transient" && entry.event?.type === "assistant/live-chunk") {
					const d = entry.event.data ?? {};
					if (d.attemptId && typeof entry.event.seq === "number") {
						const lastSeq = sharedEdgeStreamSeq.get(d.attemptId) ?? -Infinity;
						if (entry.event.seq > lastSeq) sharedEdgeStreamSeq.set(d.attemptId, entry.event.seq);
					}
				}
			}
			eventSource.subscribe(() => {
				if (readEngine() !== "edge" || !enabled) return;
				const change = eventSource.getSnapshot().change;
				if (!change) return;
				const entries = eventSource.getSnapshot().entries;
				for (const entry of entries) {
					const ev = entry?.event;
					if (!ev) continue;
					if (entry.type === "transient" && ev.type === "assistant/live-chunk") {
						const d = ev.data ?? {};
						if (d.chunk?.type === "text-delta" && d.attemptId) {
							edgeOnDelta(d.attemptId, d.turn, d.step, ev.seq, d.chunk.text);
						}
					}
				}
				// durable committed 落定：整条兜底句不重复播——只把残余尾巴 flush，
				// 并将该 attempt 标记 flushed，避免 durable 整条播再念一遍（durable 播已关）。
				if (change.kind === "append") {
					for (const entry of change.entries ?? []) {
						const text = durableMessageText(entry?.event);
						if (text === undefined) continue;
						const id = edgeFindAttemptByTurn(entry.event.data?.turn, entry.event.data?.step);
						if (id) { edgeFlushAttempt(id); edgeAttempts.get(id).flushed = true; }
						// 播过登记：该 turn 的 attempt 真喂过句子（含刚 flush 的尾巴）才登记
						markPlayedIfRead(edgeAttempts, entry.event.data?.turn, entry.event.data?.step, entry.event.data?.message?.id);
					}
				}
				if (change.kind === "settle-assistant" && change.attemptId) {
					edgeFlushAttempt(change.attemptId);
					const st = edgeAttempts.get(change.attemptId);
					if (st) st.flushed = true;
				}
			});
		}
		//#endregion

		//#region 控制条：两引擎通用（edge=暂停/继续+跳过+清空；default=暂停/继续+清空）
		// 系统 TTS 句子进浏览器内部队列无法单独撤回，故它仍只有暂停/继续+清空（行为不变）。
		// edge 队列/音频全在应用层，三项操作都做得到。按钮按引擎能力显示，避免错位。
		function ensureControlBar() {
			if (typeof document === "undefined" || !document.body || document.getElementById("dsh-aiyayi-tts-controls")) return;
			const bar = document.createElement("div");
			bar.id = "dsh-aiyayi-tts-controls";
			Object.assign(bar.style, {
				position: "fixed", right: "12px", bottom: `${128 + BUTTON_SIZE + 6}px`,
				display: "none", gap: "4px", zIndex: "59", userSelect: "none",
			});
			const mk = (label, title, onClick) => {
				const b = document.createElement("button");
				b.type = "button";
				b.textContent = label;
				b.title = title;
				Object.assign(b.style, {
					width: "28px", height: "28px", borderRadius: "50%",
					border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4))",
					background: "var(--dsw-alias-bg-base, #fff)",
					color: "var(--dsw-alias-label-secondary, #666)",
					fontSize: "13px", lineHeight: "1", cursor: "pointer", padding: "0",
					display: "flex", alignItems: "center", justifyContent: "center",
				});
				b.addEventListener("click", onClick);
				bar.appendChild(b);
				return b;
			};
			bar._pauseBtn = mk("⏸", "暂停/继续朗读", () => {
				if (readEngine() === "edge") { edgeTogglePause(); return; }
				const synth = window.speechSynthesis;
				if (!synth) return;
				if (pausedByUser) {
					pausedByUser = false;
					synth.resume(); // synth 级，连内部队列里排队的句子一起继续
				} else {
					pausedByUser = true;
					synth.pause();  // synth 级暂停，不清空队列
				}
				refreshControlBar();
			});
			// 跳过仅 edge 有（系统 TTS 进浏览器内部队列无法单独撤回）
			bar._skipBtn = mk("⏭", "跳过当前句（晓晓）", () => edgeSkipCurrent());
			mk("🗑", "清空朗读队列", () => {
				if (readEngine() === "edge") { clearEdgePlayback(); refreshControlBar(); return; }
				window.speechSynthesis?.cancel(); // cancel 会清掉浏览器队列里全部句子并触发各自 onend/onerror
				inFlight.clear();
				currentToken++;
				refreshControlBar();
			});
			document.body.appendChild(bar);
			// edge 播放链路（pump/prefetch/哨兵）未逐处调 refresh，用轻量轮询兜底：
			// 每 400ms 幂等刷一次显示状态，确保 edge 起播/凑句时按钮能及时冒出。
			// 只碰显示，不碰播放/哨兵/预取/按序任何逻辑。
			setInterval(() => refreshControlBar(), 400);
		}
		/**
		* 朗读链路是否在播/有在途（控制条显示与重听按钮"在播则停止"共用）。
		* 口径与控制条原逻辑逐字一致：edge = 在播 audio/待播队列/预取 Map/正在流式
		* 凑句的 attempt 任一非空；default = 已喂进浏览器队列未念完的句子。
		* @returns 有内容在播或排队为 true。
		*/
		function ttsBusy() {
			if (readEngine() === "edge") {
				if (edgeAudio || edgeQueue.length > 0 || edgePrefetch.size > 0) return true;
				for (const st of edgeAttempts.values()) {
					if (st.buffer && st.buffer.trim()) return true;
				}
				return false;
			}
			return streamBusy();
		}
		function refreshControlBar() {
			if (typeof document === "undefined") return;
			const bar = document.getElementById("dsh-aiyayi-tts-controls");
			if (!bar) return;
			const isEdge = readEngine() === "edge";
			// 显示条件：开关开 + 当前引擎有在播/排队内容（不再锁死 default）
			// edge 完整口径：在播 audio / 待播队列 / 预取 Map / 正在流式凑句的 attempt 任一非空即显示。
			const busy = ttsBusy();
			bar.style.display = enabled && busy ? "flex" : "none";
			if (bar._pauseBtn) bar._pauseBtn.textContent = (isEdge ? edgePausedByUser : pausedByUser) ? "▶" : "⏸";
			// 按钮按引擎能力显示：edge 三项，default 两项
			if (bar._skipBtn) bar._skipBtn.style.display = isEdge ? "flex" : "none";
		}
		//#endregion

		//#region edge-tts 桥（1.19.0）：朗读文本交给本地合成服务，音频用 <audio> 播
		let edgeAudio;
		function stopEdgeAudio() {
			if (edgeAudio) {
				try {
					edgeAudio.pause();
				} catch {}
				edgeAudio = undefined;
			}
		}
		// 同文本去重防御（1.20.1）：热换装后页面可能短暂并存两个客户端实例，各自订阅
		// 一份事件流，同一条消息会各触发一次朗读（2026-11-26 实测双读）。两份实例是
		// 互相独立的模块闭包，模块级变量彼此看不见，所以去重标记挂 window 上（页面内
		// 所有实例共享）：同文本 2 秒内只读一遍。检查放在入口、stopEdgeAudio 之前，
		// 被跳过时不打断正在播的音频；不同文本不受影响。
		function dedupState() {
			if (typeof window === "undefined") return {};
			return (window.__aiyayiTtsLastSpoken ??= {});
		}

		// ---- 分句流式播放（1.21.0）：edge 播放队列 + 并行滑动预取窗口 N=2 ----
		// 系统 TTS 靠浏览器队列衔接；edge 拿得到 mp3，能真正预取。句子一入队就把队首
		// N 句的桥 URL 并行发出、各自下载缓存；播放严格按入队顺序从 map 取，先下完的
		// 绝不许抢播。解决"下一句合成比上一句朗读慢"导致的句间延迟。
		// 早前迭代预取藏在内层 pump 里、被 in-flight 早退挡住形同虚设——1.21.0 移出。
		const EDGE_PREFETCH_N = 2;     // 并行预取窗口（求稳从2起步，不上3：走微软逆向接口）
		const edgeQueue = [];          // 待播 FIFO：[{ text, key }]，key 单调分配、不用文本（文本可能重复）
		const edgePrefetch = new Map(); // key -> { audio, text, failed }，并行预取槽
		let edgeNextKey = 0;           // 句子序号分配器（clear 后不复用，避免撞在途回调）
		let edgePlaySeq = 0;           // 播放代次=当前句 token；切引擎/清空/推进时递增，作废在途回调
		let edgeSentinelTimer = null;  // 当前句 onended 兜底哨兵
		let edgeCurrentText = "";      // 当前句文本（暂停继续时重 arm 哨兵用）
		let edgePausedByUser = false;  // edge 专用暂停标志（与系统 TTS 的 pausedByUser 分开，防切引擎错位）

		function edgeUrl(text) {
			return `${readEndpoint()}?text=${encodeURIComponent(text)}&rate=${encodeURIComponent(EDGE_TTS_RATE)}`;
		}
		/** 预取一句：建 <audio> 设 src + preload=auto，让它边下边缓存，不播放。 */
		function prefetchEdge(text) {
			if (!text) return null;
			const audio = new Audio(edgeUrl(text));
			audio.preload = "auto";
			const slot = { audio, text, failed: false };
			// 预取失败只标记、不红闪（不能影响正在播的句）；轮到它时重建走正常重试链
			audio.addEventListener("error", () => { slot.failed = true; });
			// 主动触发加载（多数浏览器设 src+preload 即开始；load() 确保启动）
			try { audio.load(); } catch {}
			return slot;
		}
		/**
		 * 维护并行预取窗口：队首 N 句若没建过预取就各建一个（并行发出桥请求）。
		 * 句子一入队就调用——这是修掉旧版"预取被 in-flight 早退挡住"的关键触发点。
		 * 严格按序由 pumpEdgeQueue 保证（只取队首 key），这里提前下载不会抢播。
		 */
		function maintainEdgePrefetch() {
			if (readEngine() !== "edge") return;
			for (let i = 0; i < Math.min(EDGE_PREFETCH_N, edgeQueue.length); i++) {
				const item = edgeQueue[i];
				if (!edgePrefetch.has(item.key)) edgePrefetch.set(item.key, prefetchEdge(item.text));
			}
		}
		function clearEdgeSentinel() {
			if (edgeSentinelTimer !== null) {
				clearTimeout(edgeSentinelTimer);
				edgeSentinelTimer = null;
			}
		}
		/**
		 * onended 兜底哨兵：Android Chrome 的 <audio>.onended 基本不触发（21:17/21:34 坐实），
		 * 推进全靠它——所以估值必须贴近真实朗读时长，太长就"念完空等"=句间顿。
		 * 1.21.0：李浩要求把空等全去掉——真实 duration 到点即推进（0 余量）；
		 * 拿不到（Infinity）兜底也去掉 1200 基础富余、直接用估算时长，下限 200ms。
		 * 风险已知悉：duration 误差/末尾静音可能切太急咬尾，真咬尾再加回 100~200ms。
		 * onended 先到仍 token 作废哨兵（不动）。
		 */
		function armEdgeSentinel(token, audio, text) {
			clearEdgeSentinel();
			let ms;
			const dur = audio.duration;
			if (typeof dur === "number" && isFinite(dur) && dur > 0) {
				// 真实时长、0 余量：一点不空等，到点就推进
				ms = dur * 1000;
			} else {
				// duration 仍 Infinity 的兜底：仅估算时长本身，不加基础富余
				ms = text.length * 200;
			}
			ms = Math.min(60000, Math.max(200, ms));
			edgeSentinelTimer = setTimeout(() => {
				edgeSentinelTimer = null;
				edgeFinishOne(token); // onended 没来也强制推进；token 相同已被推过则无效
			}, ms);
		}
		/** 本句统一收口（onended / 哨兵共用）：token 对不上说明已推进过，杜绝重复播。 */
		function edgeFinishOne(token) {
			if (token !== edgePlaySeq) return;
			edgePlaySeq++;            // 作废本句的另一个回调（onended 或哨兵后到的那个）
			clearEdgeSentinel();
			if (edgeAudio) { try { edgeAudio.onended = null; edgeAudio.onerror = null; } catch {} }
			edgeAudio = undefined;
			pumpEdgeQueue();
		}
		/** 清掉全部预取与当前音频，递增代次让在途 onended/onerror/哨兵/旧预取失效。 */
		function clearEdgePlayback() {
			edgePlaySeq++;
			edgePausedByUser = false;
			edgeCurrentText = "";
			clearEdgeSentinel();
			edgeQueue.length = 0;
			// 引擎切走/清空后，在途预取即便下载完也绝不回填：全清 + 递增代次双保险
			for (const slot of edgePrefetch.values()) {
				try { slot.audio.pause(); slot.audio.src = ""; } catch {}
			}
			edgePrefetch.clear();
			stopEdgeAudio();
		}
		/** 严格按入队顺序播放队首；命中预取槽则直切已下载好的音频（无缝），不抢播。 */
		function pumpEdgeQueue() {
			if (edgeAudio || edgeQueue.length === 0) return; // 正在播或队列空
			if (readEngine() !== "edge") return;             // 引擎已切走，别串音
			const item = edgeQueue.shift();
			const text = item.text;
			let audio;
			// 只认队首自己的 key：别的句即便先下完也不取（严格按序，不抢播）
			const slot = edgePrefetch.get(item.key);
			if (slot && !slot.failed) {
				audio = slot.audio;
			} else {
				if (slot) { try { slot.audio.src = ""; } catch {} } // 预取失败：重建走正常重试链
				audio = new Audio(edgeUrl(text));
			}
			edgePrefetch.delete(item.key);
			// 取出队首后，把窗口补满到 N 句（下一批并行预取）
			maintainEdgePrefetch();
			edgeAudio = audio;
			edgeCurrentText = text;
			edgePausedByUser = false; // 新句从非暂停态起（排队句不受上次暂停影响）
			const token = edgePlaySeq;
			armEdgeSentinel(token, audio, text); // onended 不来时兜底推进（duration 优先，小余量）
			// 起播瞬间 duration 可能还是 Infinity（chunked 流）；拿到真实时长后重设哨兵，
			// 覆盖收紧的字数兜底值。仅当这句仍在播时才重设，播完/切走的旧 audio 不回填。
			audio.addEventListener("loadedmetadata", () => {
				if (token === edgePlaySeq && edgeAudio === audio) armEdgeSentinel(token, audio, text);
			}, { once: true });
			audio.onerror = () => {
				if (token !== edgePlaySeq) return; // 已被哨兵/onended 推进或切引擎作废
				edgePlaySeq++;                     // 作废本句其它回调与哨兵
				clearEdgeSentinel();
				if (edgeAudio === audio) edgeAudio = undefined;
				// 故障：红闪 + 1.5s 重试一次（复用既有链），重试仍走这句文本
				flashEdgeFault();
				setTimeout(() => {
					if (token + 1 !== edgePlaySeq || readEngine() !== "edge") return; // 期间已被切引擎/清空
					// 重试句用新 key 放回队首（不复用旧 key，避免撞已作废的预取槽）
					edgeQueue.unshift({ text, key: edgeNextKey++ });
					maintainEdgePrefetch();
					pumpEdgeQueue();
				}, 1500);
			};
			audio.onended = () => edgeFinishOne(token); // 正常收口；与哨兵用 token 去重，不重读
			audio.play().catch((err) => {
				if (err?.name === "NotAllowedError") return; // 自动播放策略拦截，静默吞掉（同旧）
				if (token === edgePlaySeq) { edgePlaySeq++; clearEdgeSentinel(); }
				if (edgeAudio === audio) edgeAudio = undefined;
				flashEdgeFault();
			});
		}
		/** edge 分句消费端：一句文本入播放队列（去重在喂入前由调用方做）。 */
		function enqueueEdgeSentence(text) {
			if (readEngine() !== "edge" || !text) return;
			// 关键：先入队+立即触发并行预取（不受 in-flight 早退阻挡），再尝试开播。
			edgeQueue.push({ text, key: edgeNextKey++ });
			maintainEdgePrefetch();
			pumpEdgeQueue();
		}

		// ---- edge 控制条操作（两引擎通用控制条调用；仅当前引擎=edge 时生效）----
		/** 暂停/继续：暂停当前 <audio> 并撤哨兵；继续时按剩余时长重 arm，排队句不动。 */
		function edgeTogglePause() {
			if (readEngine() !== "edge" || !edgeAudio) return; // 无在播句时控制条本就隐藏
			if (!edgePausedByUser) {
				edgePausedByUser = true;
				clearEdgeSentinel();          // 暂停期间别让哨兵误推进
				try { edgeAudio.pause(); } catch {}
			} else {
				edgePausedByUser = false;
				// 按剩余时长重新 arm（真实 duration - 已播 currentTime，0 余量口径不变）
				const remaining = Math.max(0, (edgeAudio.duration || 0) - (edgeAudio.currentTime || 0));
				const token = edgePlaySeq;
				if (remaining > 0) {
					clearEdgeSentinel();
					edgeSentinelTimer = setTimeout(() => {
						edgeSentinelTimer = null;
						edgeFinishOne(token);
					}, Math.min(60000, Math.max(200, remaining * 1000)));
				} else {
					armEdgeSentinel(token, edgeAudio, edgeCurrentText);
				}
				edgeAudio.play().catch(() => {});
			}
			refreshControlBar();
		}
		/** 跳过当前句：作废当前句回调+哨兵，停音频，推进队首下一句；当前句不从预取回填。 */
		function edgeSkipCurrent() {
			if (readEngine() !== "edge") return;
			edgePlaySeq++;                // 作废当前句 onended/哨兵/onerror
			clearEdgeSentinel();
			if (edgeAudio) {
				try { edgeAudio.onended = null; edgeAudio.onerror = null; edgeAudio.pause(); edgeAudio.src = ""; } catch {}
			}
			edgeAudio = undefined;
			edgeCurrentText = "";
			edgePausedByUser = false;
			pumpEdgeQueue();              // 严格按序取下一句（预取 Map 里那句按 key 命中）
			refreshControlBar();
		}
		// 流式播放（1.20.1）：src 直接指向桥 URL，不再 fetch 攒整段 blob。桥端逐块
		// flush（无 Content-Length）时 <audio> 边下边播，长句开口延迟从「随句长线性涨」
		// 降为固定 TTFB（实测 ~1.5s）；旧版攒齐后返回（带 Content-Length）的桥同样
		// 兼容（行为同旧）。<audio> 跨源播放不需要 CORS。原来的「合成前/播放前各掐
		// 一次」合并为入口一次：没有 fetch await 了，掐断到 play() 之间是同步的。
		async function speakViaEdge(cleanText, isRetry = false) {
			const last = dedupState();
			const now = Date.now();
			if (!isRetry && cleanText === last.lastSpokenText && now - last.lastSpokenAt < 2000) {
				console.log("[aiyayi-tts] 同文本 2 秒内重复触发，跳过朗读");
				return;
			}
			last.lastSpokenText = cleanText;
			last.lastSpokenAt = now;
			stopEdgeAudio();
			const audio = new Audio(`${readEndpoint()}?text=${encodeURIComponent(cleanText)}&rate=${encodeURIComponent(EDGE_TTS_RATE)}`);
			edgeAudio = audio;
			// HTTP 层/解码层错误走 audio 的 error 事件，在这里转成 Promise 拒绝，接回
			// speak() 里既有的「红闪 ⚠ + 1.5s 重试一次」故障链。
			await new Promise((resolve, reject) => {
				audio.onerror = () => {
					if (edgeAudio === audio) edgeAudio = undefined;
					reject(new Error("edge-tts audio error"));
				};
				audio.addEventListener("playing", resolve, { once: true });
				// 被新消息掐掉或自然播完也算本轮结束（pause 在自然播完时同样触发）
				audio.addEventListener("pause", resolve, { once: true });
				// play() 本身的拒绝里只有自动播放策略拦截不算桥故障（旧版同款静默吞掉）；
				// 其余 play() 失败会有 error 事件随行，交给上面的 onerror 接故障链。
				audio.play().catch((err) => {
					// 自动播放策略拦截 = 旧版同款静默吞掉，不算桥故障；其余 play() 拒绝
					// 兜底当故障诊断（多数情况 onerror 会先到，reject 幂等）。
					if (err?.name === "NotAllowedError") resolve();
					else reject(err);
				});
			});
		}
		/** edge 桥故障提示：开关上 ⚠ 红色一瞬（服务不在/合成失败给个看得见的信号，不弹窗不打扰）。 */
		function flashEdgeFault() {
			if (typeof document === "undefined") return;
			const node = document.getElementById("dsh-aiyayi-tts-toggle");
			if (!node) return;
			node.textContent = `${node.textContent}⚠`;
			node.style.color = "#e5484d";
			setTimeout(() => {
				node.style.color = "";
				refreshButton(node);
			}, 2500);
		}
		//#endregion

		function speak(text) {
			const clean = cleanForSpeech(text);
			if (!clean) return;
			if (readEngine() === "edge") {
				// 1.21.0 分句流式：整条文本（调试钩子/兜底）也走播放队列，内部带预取+重试。
				// 真实消息由 live-chunk 分句喂入；这里的整条兜底只在手动 __aiyayiTts.speak 时用。
				enqueueEdgeSentence(clean);
				return;
			}
			const synth = window.speechSynthesis;
			if (!synth) return;
			// 新消息先掐掉上一条，避免叠音
			synth.cancel();
			const utterance = new SpeechSynthesisUtterance(clean);
			const voice = pickVoice();
			if (voice) utterance.voice = voice;
			utterance.lang = voice?.lang || "zh-CN";
			utterance.rate = 1.1;
			utterance.onerror = () => {};
			synth.speak(utterance);
		}
		function stopSpeaking() {
			clearEdgePlayback();          // 清 edge 播放队列/预取，递增代次作废在途 onended（含 edgePausedByUser=false）
			window.speechSynthesis?.cancel(); // 清系统 TTS 预喂队列
			// 引擎互切/关闭后暂停状态归位，避免切回去时 speechSynthesis 还停在 paused
			pausedByUser = false;
			try { window.speechSynthesis?.resume(); } catch {}
			inFlight.clear();
			currentToken++;
			refreshControlBar();
		}
		//#endregion

		//#region 浮动开关按钮
		const BUTTON_SIZE = 40;
		//#region 哑窗口：复制带认证的完整 URL
		// 向引擎要带 token 的 URL（服务端见 lib/auth-url.js；/api 前缀路由，
		// 未登录会被 Connection 栅栏 401 拦下，这里把失败讲成"请先登录 dsh web"）。
		async function copyAuthenticatedUrl() {
			try {
				const response = await fetch("/api/aiyayi/auth-url", { method: "GET", cache: "no-store" });
				if (!response.ok) {
					window.alert("获取认证 URL 失败：" + (response.status === 401 ? "请先登录 dsh web。" : "HTTP " + response.status + "——请确认已登录 dsh web。"));
					return;
				}
				const data = await response.json();
				const url = data?.url;
				if (typeof url !== "string" || url === "") {
					window.alert("获取认证 URL 失败：服务端没有返回 url——请确认已登录 dsh web。");
					return;
				}
				try {
					await navigator.clipboard.writeText(url);
					window.alert("已复制带认证的完整 URL，粘贴到 Chrome/Edge/Firefox 打开即可自动朗读。\n注意：此 URL 是长期有效的引擎钥匙，自用可以，别发给别人。");
				} catch {
					// WebView 常见 NotAllowedError：剪贴板 API 不可用，降级手动复制
					window.prompt("剪贴板不可用，请手动复制：", url);
				}
			} catch (error) {
				window.alert("获取认证 URL 失败：" + (error?.message ?? String(error)) + "——请确认已登录 dsh web。");
			}
		}
		//#endregion

		function ensureButton(onToggle) {
			if (typeof document === "undefined" || !document.body || document.getElementById("dsh-aiyayi-tts-toggle")) return;
			const button = document.createElement("button");
			button.id = "dsh-aiyayi-tts-toggle";
			button.type = "button";
			button.setAttribute("aria-label", "自动朗读开关");
			button.title = "新消息自动朗读（阿依娅伊）";
			Object.assign(button.style, {
				position: "fixed",
				right: "12px",
				bottom: "128px",
				width: `${BUTTON_SIZE}px`,
				height: `${BUTTON_SIZE}px`,
				borderRadius: "50%",
				border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4))",
				background: "var(--dsw-alias-bg-base, #fff)",
				color: "var(--dsw-alias-label-secondary, #666)",
				fontSize: "18px",
				lineHeight: "1",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				zIndex: "60",
				opacity: "0.55",
				cursor: "pointer",
				boxShadow: "0 2px 8px rgba(0,0,0,.15)",
				transition: "opacity .15s"
			});
			if (!ttsSupported()) {
				// 哑窗口：按钮置灰 + 禁用态样式，点击复制带认证的完整 URL（B 半逻辑）
				button.style.cursor = "not-allowed";
				button.style.filter = "grayscale(1)";
				button.style.opacity = "0.3";
				button.addEventListener("mouseenter", () => {
					button.style.opacity = "0.45";
				});
				button.addEventListener("mouseleave", () => {
					button.style.opacity = "0.3";
				});
				button.addEventListener("click", () => {
					copyAuthenticatedUrl();
				});
			} else {
				button.addEventListener("mouseenter", () => {
					button.style.opacity = "1";
				});
				button.addEventListener("mouseleave", () => {
					button.style.opacity = "0.55";
				});
				button.addEventListener("click", () => onToggle());
			}
			// 右键弹引擎切换菜单（晓晓/系统），哑窗口也能切到 edge 续命
			button.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				toggleEngineMenu();
			});
			document.body.appendChild(button);
			refreshButton(button);
		}
		function refreshButton(button) {
			const node = button ?? document.getElementById("dsh-aiyayi-tts-toggle");
			if (!node) return;
			// ✦ 徽标：当前 engine=edge（晓晓在线合成）时挂在 🔊/🔇 后面
			node.textContent = (enabled ? "🔊" : "🔇") + (readEngine() === "edge" ? "✦" : "");
			node.style.opacity = !ttsSupported() ? "0.3" : enabled ? "1" : "0.55";
		}
		//#region 引擎切换小控件：右键朗读开关弹出，晓晓 ↔ 系统一键互切
		function toggleEngineMenu() {
			const existing = document.getElementById("dsh-aiyayi-tts-engine-menu");
			if (existing) {
				existing.remove();
				return;
			}
			const menu = document.createElement("div");
			menu.id = "dsh-aiyayi-tts-engine-menu";
			const current = readEngine();
			const items = [
				{ value: "edge", label: "✦ 晓晓（微软在线）" },
				{ value: "default", label: "系统语音（兜底）" },
			];
			for (const item of items) {
				const row = document.createElement("div");
				row.textContent = `${current === item.value ? "●" : "○"} ${item.label}`;
				Object.assign(row.style, {
					padding: "6px 14px",
					cursor: "pointer",
					whiteSpace: "nowrap",
					fontSize: "12px",
					color: current === item.value ? "var(--dsw-alias-label-primary, #111)" : "var(--dsw-alias-label-secondary, #666)",
				});
				row.addEventListener("click", () => {
					try {
						localStorage.setItem(ENGINE_KEY, item.value);
					} catch {}
					menu.remove();
					refreshButton();
					// 切到 edge 时停掉 default 的流式队列并隐藏控制条；切回 default 按状态刷新
					// 引擎互切：两个方向都把对方（及自己旧队列）cancel 干净，避免串音
					stopSpeaking();
					refreshControlBar();
				});
				menu.appendChild(row);
			}
			Object.assign(menu.style, {
				position: "fixed",
				right: "12px",
				bottom: `${128 + BUTTON_SIZE + 6}px`,
				background: "var(--dsw-alias-bg-base, #fff)",
				border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4))",
				borderRadius: "8px",
				boxShadow: "0 2px 8px rgba(0,0,0,.15)",
				padding: "4px 0",
				zIndex: "61",
				userSelect: "none",
			});
			document.body.appendChild(menu);
			// 点菜单外面任意处收起（capture 先于菜单行自己的 click，contains 放行行内点击）
			document.addEventListener("click", (event) => {
				if (!menu.contains(event.target)) menu.remove();
			}, { once: true, capture: true });
		}
		//#endregion
		function mountButton(onToggle) {
			if (typeof document === "undefined") return;
			if (document.readyState === "loading") {
				document.addEventListener("DOMContentLoaded", () => ensureButton(onToggle), { once: true });
			} else {
				ensureButton(onToggle);
			}
		}
		//#endregion

		//#region 会话事件订阅：识别"助手最终回复落定"
		// 每条事件源一个钩子：记录已朗读到的最大 seq，避免历史回放/重连 resync 重复朗读。
		const wiredSessions = new WeakSet();
		const lastSpokenSeq = new Map();
		/** 从事件里取出最终助手消息文本；非目标事件返回 undefined。 */
		function finalAssistantText(event) {
			if (event?.type !== "assistant/message") return undefined;
			if (event.surfaceOp !== "append") return undefined;
			if (event.data?.interrupted === true) return undefined;
			const content = event.data?.message?.content;
			if (typeof content === "string") return content;
			if (!Array.isArray(content)) return undefined;
			return content.filter((block) => (block?.type === "text" || block?.kind === "text") && typeof block.text === "string").map((block) => block.text).join("");
		}
		function entrySeq(entry) {
			return entry?.event?.seq;
		}
		function wireSession(sessionId, eventSource, speakNow) {
			if (wiredSessions.has(eventSource)) return;
			wiredSessions.add(eventSource);
			// 首次接线：把当前窗口里最大的 seq 记为已处理，历史消息不念
			let baseline = 0;
			for (const entry of eventSource.getSnapshot().entries) {
				const seq = entrySeq(entry);
				if (typeof seq === "number" && seq > baseline) baseline = seq;
			}
			lastSpokenSeq.set(sessionId, baseline);
			eventSource.subscribe(() => {
				const snapshot = eventSource.getSnapshot();
				const change = snapshot.change;
				if (!change) return;
				// prepend 是翻旧历史，不念；replace/append 都按 seq 增量处理
				const candidates = change.kind === "append" ? change.entries : snapshot.entries;
				for (const entry of candidates) {
					const seq = entrySeq(entry);
					if (typeof seq !== "number" || seq <= (lastSpokenSeq.get(sessionId) ?? 0)) continue;
					const spoken = finalAssistantText(entry.event);
					// 无论是否朗读都推进水位，保证一条只处理一次
					lastSpokenSeq.set(sessionId, seq);
					// 1.21.0：default（预喂系统 TTS）与 edge（分句流式+预取）都已在 live-chunk
					// 层逐句朗读，durable 整条落定不再播，避免与分句队列重复。
					// speakNow 保留为调试钩子入口（window.__aiyayiTts.speak），事件流不再调用。
				}
			});
		}
		//#endregion

		//#region 消息气泡重听按钮（未发布 · 方案A：官方槽 conversation.chat.assistant-actions）
		// 调研报告：docs/20261127-消息气泡重听-DOM调研.md。turn-tail 尾行由宿主渲染，
		// 我们只注册槽 entry（React 组件），不碰任何 DOM 选择器；每 turn 一个按钮
		// （多 step turn 只最后一步有、被中断的 turn 无 messageId 不出按钮——接受口径）。
		/** 播过登记：localStorage map（messageId -> 时间戳），播过的按钮高亮；上限 200 条防膨胀。 */
		const PLAYED_KEY = "dsh-aiyayi-tts.played";
		/** 播过登记变化的订阅者（按钮重渲染用）。 */
		const playedListeners = new Set();
		/** sessions 服务（apply 接线时回填；重听按钮按 messageId 取当轮文本用）。 */
		let sessionsService = null;

		/** 读整张播过登记表（坏数据当空表）。 */
		function readPlayedMap() {
			try {
				const map = JSON.parse(localStorage.getItem(PLAYED_KEY) || "{}");
				return map && typeof map === "object" && !Array.isArray(map) ? map : {};
			} catch {
				return {};
			}
		}
		/** 这条消息播过没有（按钮高亮判据）。 */
		function isPlayed(messageId) {
			return !!messageId && !!readPlayedMap()[messageId];
		}
		/** 登记"播过"（幂等）；变化后通知按钮重渲染。 */
		function markPlayed(messageId) {
			if (!messageId) return;
			try {
				const map = readPlayedMap();
				if (map[messageId]) return;
				map[messageId] = Date.now();
				const keys = Object.keys(map);
				if (keys.length > 200) {
					keys.sort((a, b) => (map[a] ?? 0) - (map[b] ?? 0));
					for (const key of keys.slice(0, keys.length - 200)) delete map[key];
				}
				localStorage.setItem(PLAYED_KEY, JSON.stringify(map));
			} catch {}
			for (const listener of [...playedListeners]) {
				try { listener(); } catch {}
			}
		}
		/**
		 * 播过登记（自动朗读侧）：该 turn 的流式 attempt 真喂过句子才登记，
		 * 没喂过（开关关/流式订阅死/全围栏内容）不登记——"消息真被朗读过才登记"口径。
		 * @param attempts - 该引擎的 attempt 状态表（streamAttempts / edgeAttempts）。
		 * @param turn - durable 事件的 data.turn。
		 * @param step - durable 事件的 data.step。
		 * @param messageId - durable 事件的 data.message.id。
		 */
		function markPlayedIfRead(attempts, turn, step, messageId) {
			if (!messageId) return;
			for (const st of attempts.values()) {
				if (st.turn === turn && st.step === step && st.fed) {
					markPlayed(messageId);
					return;
				}
			}
		}
		/**
		 * 取该轮 assistant 消息的朗读文本：① 事件流已加载窗口内按 messageId 精确取
		 * （durableMessageText，与自动朗读同源同格式）；② 不在窗口则兜底读该 turn
		 * 尾行前最后一个 assistant-step 行的 innerText（调研报告 §3 口径）。
		 * @param sessionId - 会话 id（槽 binding.key）。
		 * @param messageId - durable messageId（槽 ownerProps）。
		 * @param anchor - 按钮 DOM（兜底定位 turn 尾行用）。
		 * @returns 朗读文本；找不到返回 ""。
		 */
		function resolveReplayText(sessionId, messageId, anchor) {
			// ① 事件流（首选）
			try {
				const entries = sessionsService?.binding?.(sessionId)?.eventSource?.getSnapshot?.()?.entries ?? [];
				let found = "";
				for (const entry of entries) {
					const ev = entry?.event;
					if (ev?.type === "assistant/message" && ev.data?.message?.id === messageId) {
						const text = durableMessageText(ev);
						if (text) found = text; // 多条 append 取最后一条（最新落定）
					}
				}
				if (found) return found;
			} catch {}
			// ② DOM 兜底：turn 尾行往前找最近的 assistant-step 行 innerText
			try {
				const tailRow = anchor?.closest?.('[data-chat-flow-kind="turn-tail"]');
				if (tailRow) {
					const turn = tailRow.getAttribute("data-chat-turn");
					let node = tailRow.previousElementSibling;
					while (node) {
						if (node.matches?.('[data-chat-flow-kind="assistant-step"]')) {
							const stepTurn = node.getAttribute("data-chat-turn");
							if (!turn || !stepTurn || stepTurn === turn) {
								const text = node.innerText?.trim();
								if (text) return text;
							}
						}
						node = node.previousElementSibling;
					}
				}
			} catch {}
			return "";
		}
		/** 点击重听：在播就停，没播就取文朗读并登记"播过"。 */
		function onReplayClick(messageId, sessionId, anchor) {
			try {
				if (ttsBusy()) { stopSpeaking(); return; }
				const text = resolveReplayText(sessionId, messageId, anchor);
				if (!text) { console.warn("dsh-aiyayi: 重听失败，找不到该消息文本", messageId); return; }
				stopSpeaking(); // 清残留状态，避免与在读内容叠音
				speak(text);
				markPlayed(messageId);
			} catch (error) {
				console.warn("dsh-aiyayi: 重听失败", error);
			}
		}
		/** 造重听按钮组件（React 由 registerReplaySlot 传入；messageId 缺失的 turn 不出按钮）。 */
		function makeReplayButton(React) {
			return function ReplayButton({ messageId, sessionId }) {
				const [, bump] = React.useState(0);
				React.useEffect(() => {
					const onChange = () => bump((n) => n + 1);
					playedListeners.add(onChange);
					return () => playedListeners.delete(onChange);
				}, []);
				if (!messageId) return null; // 被中断的 turn 等无 messageId 场景：不出按钮
				const played = isPlayed(messageId);
				const label = played ? "重听这条回复（已播过）" : "重听这条回复";
				return React.createElement("button", {
					type: "button",
					"aria-label": label,
					title: label,
					onClick: (event) => {
						event.stopPropagation();
						onReplayClick(messageId, sessionId, event.currentTarget);
					},
					style: {
						border: "none",
						background: played ? "rgba(125,160,255,0.20)" : "transparent",
						borderRadius: "6px",
						cursor: "pointer",
						fontSize: "14px",
						lineHeight: "1",
						padding: "6px",
						minWidth: "32px",
						minHeight: "32px",
						opacity: played ? "1" : "0.6",
					},
				}, "🔊");
			};
		}
		/**
		 * 注册重听按钮到官方槽 conversation.chat.assistant-actions（list/session，
		 * replaceRisk none）。槽由宿主 ui-chat 声明，inject 等到声明出现再执行；
		 * 热换装重叠期同 id（同 priority）重复注册会抛，退避重试等旧实例退场。
		 * @param ctx - 客户端根上下文。
		 * @param React - require("react") 结果。
		 */
		function registerReplaySlot(ctx, React) {
			const ReplayButton = makeReplayButton(React);
			ctx.effect(() => {
				let stopped = false;
				let attempts = 0;
				let disposeEntry = null;
				const register = () => {
					if (stopped) return;
					try {
						disposeEntry = ctx.slots.register({
							name: "conversation.chat.assistant-actions",
							id: "dsh-aiyayi/tts-replay",
							order: 30,
							inject: (sessionId) => ({ sessionId }),
						}, ReplayButton);
					} catch (error) {
						attempts += 1;
						if (attempts <= 10) setTimeout(register, 500);
						else console.warn("dsh-aiyayi: 重听按钮注册失败", error);
					}
				};
				const disposeInject = ctx.slots.inject("conversation.chat.assistant-actions", () => {
					register();
					// 声明方 effect 收尾时清理本实例的 entry（幂等）
					return () => { disposeEntry?.(); disposeEntry = null; };
				});
				return () => {
					stopped = true;
					disposeInject?.();
					disposeEntry?.();
					disposeEntry = null;
				};
			}, "dsh-aiyayi: tts replay button");
		}
		//#endregion

		//#region 客户端插件主体
		// 需要的客户端服务：sessions 由 @deepseek-ai/dsh-api-session-controller 提供；
		// slots 由 @deepseek-ai/dsh-client-ui-slots 提供（重听按钮注册用）。
		const inject = ["sessions", "slots"];
		/**
		* 挂载自动朗读：等 sessions 服务就绪后接线当前已知会话，
		* 并跟随会话清单变化补接新会话。
		* @param ctx - 客户端根上下文。
		* @returns 注入完成的 promise（模块系统会等它落定）。
		*/
		async function apply(ctx) {
			mountButton(() => {
				enabled = !enabled;
				writeEnabled(enabled);
				refreshButton();
				if (enabled) { ensureControlBar(); refreshControlBar(); }
				else stopSpeaking();
			});
			ensureControlBar();
			refreshControlBar();
			// 验证/调试钩子：控制台 window.__aiyayiTts.speak("文本") 可直接触发一次朗读
			try {
				window.__aiyayiTts = { speak: (raw) => speak(raw) };
			} catch {}
			// 消息气泡重听喇叭（未发布 · 方案A）：哑窗口也注册——edge 引擎不依赖
			// speechSynthesis，且注册本身只是出按钮，不影响朗读链路。
			try {
				const React = require("react");
				if (React?.createElement && typeof ctx.slots?.inject === "function" && typeof ctx.slots?.register === "function") {
					registerReplaySlot(ctx, React);
				} else {
					console.warn("dsh-aiyayi: react/slots 服务缺失，重听按钮未注册");
				}
			} catch (error) {
				console.warn("dsh-aiyayi: react 不可用，重听按钮未注册", error);
			}
			ctx.effect(() => () => {
				stopSpeaking();
			}, "aiyayi-tts: stop speech on teardown");
			if (!ttsSupported()) return; // 哑窗口：朗读全链路（事件订阅）不启动
			await ctx.inject(["sessions"], (scope) => {
				const sessions = scope.sessions ?? scope.get?.("sessions");
				if (!sessions?.list || typeof sessions.binding !== "function") return;
				sessionsService = sessions; // 重听按钮按 messageId 取文本用
				const speakNow = (text) => speak(text);
				// 只接顶层会话（parentSessionId 为空），子智能体后台会话不念
				const wireVisible = () => {
					const state = sessions.list.getSnapshot();
					for (const id of state.ids ?? []) {
						const row = state.byId?.[id];
						if (row?.parentSessionId) continue;
						const binding = sessions.binding(id);
						if (binding?.eventSource) {
							wireSession(id, binding.eventSource, speakNow);
							wireStreamSession(id, binding.eventSource);   // 系统 TTS 分句
							edgeWireStreamSession(id, binding.eventSource); // edge 分句（1.21.0）
						}
					}
				};
				sessions.list.subscribe(wireVisible);
				wireVisible();
			});
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		// 测试钩子（仅供 node --test）：朗读清洗纯函数
		exports.__testing = { cleanForSpeech, stripMarkdown };
		return module.exports;
	}
});
