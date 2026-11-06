/**
 * aiyayi-presence-worker — 小伙伴侧的轻量存在感（只挂 aiyayi-worker preset）。
 *
 * 干两件事，见 presence.js 里 createWorkerApply 的注释：
 * 1. 检索员（孙代）失败断因透传：宿主对孙代只回 "failed before it finished"，
 *    这里把真原因注进小伙伴的下一步，让它能判断续派还是重派；
 * 2. 小伙伴会话登记进共享账本，模型切换能传到名下检索员（孙代模型跟随）。
 *
 * 不带任何工具、不碰本体的 presence.json——本体人格件与工具人严格分居。
 * 实现全部在 presence.js（共享同一套会话账本），这里只是挂载壳。
 */
import { createWorkerApply } from './presence.js'

/** Loader 身份。 */
export const name = 'aiyayi-presence-worker'

/** 需要的服务（与 aiyayi-presence 一致，实际只用事件总线与 pre-step）。 */
export const inject = ['tools']

/**
 * 注册小伙伴侧存在感。
 * @param ctx - preset 作用域内的 agent 上下文。
 */
export const apply = createWorkerApply(name)
