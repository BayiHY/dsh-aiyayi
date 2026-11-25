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
// - 新消息到来先 cancel 上一条，避免叠音；rate 1.1 稍快。
// - 哑窗口降级（1.17.0）：页面没有 window.speechSynthesis（或其 speak 不可用）
//   时，开关按钮仍然渲染但置灰、样式呈禁用态；点击改为向引擎要一个带认证的
//   完整 URL（GET /api/aiyayi/auth-url，登录态栅栏后的 exact fetch 路由），
//   复制到剪贴板并用弹窗提示正路（用 Chrome / Edge / Firefox 打开即可自动
//   朗读）；剪贴板不可用时降级为 prompt 手动复制，接口失败弹失败说明。
//   朗读全链路不启动。支持时行为完全不变。

window.__ModuleLoader__?.load({
	id: "dsh-aiyayi",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const NS = "aiyayi-tts";
		const STORE_KEY = "dsh-aiyayi-tts.enabled";
		const MAX_SPEAK_CHARS = 2000;

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
		//#endregion

		//#region 文本清洗：把 markdown/URL 清成适合念出来的话
		function cleanForSpeech(raw) {
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
			// 表格：分隔行整行去掉，数据行去竖线
			text = text.split("\n").filter((line) => !/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line)).map((line) => line.replace(/\s*\|\s*/g, " ").trim()).join("\n");
			// 标题、引用、加粗/斜体记号
			text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");
			text = text.replace(/^\s{0,3}>\s?/gm, "");
			text = text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1$2");
			// 合并空白，截断超长
			text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
			if (text.length > MAX_SPEAK_CHARS) text = `${text.slice(0, MAX_SPEAK_CHARS)}……后面还有内容就不念了`;
			return text;
		}
		//#endregion

		//#region 语音
		// 能力检测（1.17.0）：内嵌 WebView（如 DSH-Go App 窗口）常无 speechSynthesis，
		// 直接打开会"点了开关也没声"。检测口径：对象不存在，或 speak 不是函数，都算不支持。
		const ttsSupported = typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined" && typeof window.speechSynthesis?.speak === "function";
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
		function speak(text) {
			const synth = window.speechSynthesis;
			if (!synth) return;
			const clean = cleanForSpeech(text);
			if (!clean) return;
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
			window.speechSynthesis?.cancel();
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
			if (!ttsSupported) {
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
			document.body.appendChild(button);
			refreshButton(button);
		}
		function refreshButton(button) {
			const node = button ?? document.getElementById("dsh-aiyayi-tts-toggle");
			if (!node) return;
			node.textContent = enabled ? "🔊" : "🔇";
			node.style.opacity = !ttsSupported ? "0.3" : enabled ? "1" : "0.55";
		}
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
					if (spoken !== undefined && enabled) speakNow(spoken);
				}
			});
		}
		//#endregion

		//#region 客户端插件主体
		// 需要的客户端服务：sessions 由 @deepseek-ai/dsh-api-session-controller 提供。
		const inject = ["sessions"];
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
				if (!enabled) stopSpeaking();
			});
			ctx.effect(() => () => {
				stopSpeaking();
			}, "aiyayi-tts: stop speech on teardown");
			if (!ttsSupported) return; // 哑窗口：朗读全链路（事件订阅）不启动
			await ctx.inject(["sessions"], (scope) => {
				const sessions = scope.sessions ?? scope.get?.("sessions");
				if (!sessions?.list || typeof sessions.binding !== "function") return;
				const speakNow = (text) => speak(text);
				// 只接顶层会话（parentSessionId 为空），子智能体后台会话不念
				const wireVisible = () => {
					const state = sessions.list.getSnapshot();
					for (const id of state.ids ?? []) {
						const row = state.byId?.[id];
						if (row?.parentSessionId) continue;
						const binding = sessions.binding(id);
						if (binding?.eventSource) wireSession(id, binding.eventSource, speakNow);
					}
				};
				sessions.list.subscribe(wireVisible);
				wireVisible();
			});
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
