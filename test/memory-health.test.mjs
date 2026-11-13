/**
 * memory_organize 档案健康度单测（fileHealth / HEALTH_SCHEMA）。
 *
 * 为什么要有它：2026-11-13 的 precompact 垃圾沉淀事故把 `memories/事情/经验.md`
 * 灌到 266KB，而 memory_organize 的 read/tree 当时只报"解析得出来的条目"，
 * 文件真实多大、混了多少非条目垃圾一概看不见——事后是靠别的工具直读文件才
 * 发现的。健康度就是那次事故的补丁，但它落地时零测试覆盖；本文件把它钉住。
 *
 * 覆盖：
 *   1) 干净档案：字节/行/条目数对得上，非条目 0、占比 0、不预警；
 *   2) 污染档案：条目 + 大段垃圾 → 非条目占比按"非空行"算，出污染预警；
 *   3) 空档案 / 只有空白：不抛、不 NaN（除零兜底）；
 *   4) 只有非条目：占比 1，照样预警（"看不见垃圾"正是那次事故的病根）；
 *   5) 字节口径：UTF-8 字节数（Buffer.byteLength），不是字符数；
 *   6) 膨胀判据：字节 > 条目数 × 平均条目长度 × 5 才出第二条预警；
 *   7) schema 一致性：HEALTH_SCHEMA 必须覆盖 fileHealth 实际返回的每个键
 *      （防 precompact_run 那种"返回字段没声明"在 additionalProperties:false 下炸掉）。
 *
 * fileHealth 是纯函数：所有 fixture 都是字符串直接传进去，不读磁盘、不碰真实记忆库。
 * HEALTH_SCHEMA 没有单独导出，只能通过真实 `apply()` 注册出来的 memory_organize
 * 工具定义拿到（与 tools-surface / precompact 两处测试同一套假 ctx 做法）。
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { apply, __testing } from '../lib/index.js'
import { __testing as homeTesting } from '../lib/home.js'

const { fileHealth } = __testing

/* ------------------------------------------------------------------ *
 * 沙盘隔离：只给 schema 测试里的 apply() 用。fileHealth 本身是纯函数，
 * fixture 一律走字符串，绝不读真实记忆库（D:\阿依娅伊\记忆）。
 * ------------------------------------------------------------------ */
const sandbox = mkdtempSync(join(tmpdir(), 'aiyayi-memory-health-'))
const root = join(sandbox, 'root')
mkdirSync(join(root, 'memories'), { recursive: true })
process.env.AIYAYI_HOME = root
// 指路文件也定向到沙盘，避免真机 location.json 覆盖 AIYAYI_HOME。
homeTesting.setPointerPath(join(sandbox, 'pointer', 'location.json'))
mkdirSync(join(sandbox, 'pointer'), { recursive: true })
homeTesting.pointerCacheReset()

after(() => {
  try {
    rmSync(sandbox, { recursive: true, force: true })
  } catch {
    /* 临时目录清不掉不影响结论 */
  }
})

/* ------------------------------------------------------------------ *
 * fixture：全是字符串，不落盘。
 * ------------------------------------------------------------------ */
const CLEAN = [
  '- [2026-11-13 12:50] 用户住在杭州，口味清淡。',
  '- [2026-11-13 13:05] 约定：每周日晚上一起复盘。',
  '- [2026-11-13 14:20] 结论：外置盘没插时记忆不可达。',
].join('\n')

const DIRTY = [
  '- [2026-11-13 12:50] 用户住在杭州，口味清淡。',
  '下面是 precompact 注入残留的一大段文字，压根不是条目行，它混在档案里。',
  '- [2026-11-13 13:05] 约定：每周日晚上一起复盘。',
  '另一段垃圾：从会话摘要里掉下来的长句，没有时间戳，也没有条目前缀，应该被算作非条目。',
  '- [2026-11-13 14:20] 结论：外置盘没插时记忆不可达。',
  '第三段垃圾：批量注入留下的说明文字，同样不是条目行，混在中间。',
].join('\n')

const GARBAGE_ONLY = [
  '这是 precompact 注入残留，没有条目前缀，也没有时间戳。',
  '- [ 残缺的条目行，时间戳没闭合',
  '纯文本一行，什么都没有了。',
].join('\n')

// 条目很少、文件被非条目文本撑大：正是 266KB 那次事故的形状。
const PADDING = '这是一段被批量注入进来的垃圾文本，'.repeat(12)
const HUGE = [
  '- [2026-11-13 12:50] 用户住在杭州，口味清淡。',
  PADDING,
  '- [2026-11-13 13:05] 约定：每周日晚上一起复盘。',
  PADDING,
  PADDING,
].join('\n')

/* ------------------------------------------------------------------ *
 * 1. 干净档案：数字对得上，不预警
 * ------------------------------------------------------------------ */
test('A. 干净档案：3 条标准条目 → 非条目 0、占比 0、无预警', () => {
  const health = fileHealth(CLEAN)
  assert.equal(health.bytes, 185, '185 = 整份文本的 UTF-8 字节数')
  assert.equal(health.bytes, Buffer.byteLength(CLEAN, 'utf8'), 'bytes 口径 = Buffer.byteLength')
  assert.equal(health.lines, 3, '三行条目 = 三行')
  assert.equal(health.entries, 3, '三条都能按 `- [时间] …` 解析出来')
  assert.equal(health.nonEntry, 0)
  assert.equal(health.ratio, 0, '没有非条目 → 占比 0')
  assert.equal(health.avgEntryBytes, 61, '平均条目字节数 = 三条 trimmed 行字节数的均值')
  assert.deepEqual(health.warnings, [], '健康档案不给任何预警')
})

test('A2. 末尾换行不算一行（split 出来的空串要丢掉）', () => {
  assert.equal(fileHealth(`${CLEAN}\n`).lines, 3, '末尾换行不该多报一行')
  assert.equal(fileHealth(`${CLEAN}\n`).entries, 3)
  assert.equal(fileHealth(CLEAN.replaceAll('\n', '\r\n')).lines, 3, 'CRLF 也只算 3 行')
  assert.equal(fileHealth(CLEAN.replaceAll('\n', '\r\n')).entries, 3, 'CRLF 下的条目照样解析得出来')
})

/* ------------------------------------------------------------------ *
 * 2. 污染档案：占比按"非空行"算，出污染预警
 * ------------------------------------------------------------------ */
test('B. 污染档案：3 条条目 + 3 行大段垃圾 → nonEntry=3、ratio=0.5、带污染预警', () => {
  const health = fileHealth(DIRTY)
  assert.equal(health.lines, 6)
  assert.equal(health.entries, 3, '垃圾行不该被当成条目')
  assert.equal(health.nonEntry, 3, '非空、但解析不出条目的行 = 3')
  assert.equal(health.ratio, 0.5, 'ratio = nonEntry / (entries + nonEntry) = 3/6')
  assert.equal(health.bytes, 506)
  assert.equal(health.bytes, Buffer.byteLength(DIRTY, 'utf8'))
  assert.ok(health.warnings.length > 0, '有垃圾就必须预警')
  assert.match(health.warnings[0], /污染/, '预警要说清是"被污染了"')
  assert.match(health.warnings[0], /50%/, '预警要报出真实占比')
  assert.match(health.warnings[0], /3 行非条目 \/ 6 行非空/, '预警要报出分子分母（别让模型瞎猜）')
  assert.match(health.warnings.at(-1), /^建议：/, '最后一行是建议动作（先备份、再清垃圾、tree 复核）')
})

/* ------------------------------------------------------------------ *
 * 3. 空档案 / 只有空白：不抛、不 NaN
 * ------------------------------------------------------------------ */
test('C. 空档案：不抛异常，entries=0、ratio=0（除零不能变 NaN）、无预警', () => {
  for (const empty of ['', null, undefined, '\n', '\n\n\n']) {
    const health = fileHealth(empty)
    assert.equal(typeof health, 'object', `fixture ${JSON.stringify(empty)} 应该正常返回对象`)
    assert.equal(health.entries, 0)
    assert.equal(health.nonEntry, 0)
    assert.equal(health.avgEntryBytes, 0, '无条目 → 平均条目字节数 0')
    assert.equal(health.ratio, 0, '0/0 必须兜底成 0，不能是 NaN')
    assert.equal(Number.isNaN(health.ratio), false)
    assert.deepEqual(health.warnings, [], '空档案不该预警')
  }
  assert.equal(fileHealth('').bytes, 0)
  assert.equal(fileHealth('').lines, 0)
})

test('C2. 只有空白（空格/制表符/换行）：算空行，不计非条目', () => {
  const health = fileHealth('  \n\n\t\n')
  assert.equal(health.bytes, 6, '空白也是字节：两个空格 + 换行 + 换行 + Tab + 换行')
  assert.equal(health.lines, 3, '拆出 3 行（末尾换行那行不算）')
  assert.equal(health.entries, 0)
  assert.equal(health.nonEntry, 0, '纯空白行只是空行，不算"非条目垃圾"')
  assert.equal(health.ratio, 0, '没有任何非空行 → 占比 0，不能除零')
  assert.equal(health.avgEntryBytes, 0)
  assert.deepEqual(health.warnings, [])
})

/* ------------------------------------------------------------------ *
 * 4. 只有非条目内容：ratio=1，更要预警
 * ------------------------------------------------------------------ */
test('D. 只有垃圾没有条目：ratio=1、entries=0、照样预警', () => {
  const health = fileHealth(GARBAGE_ONLY)
  assert.equal(health.entries, 0, '一条都解析不出来')
  assert.equal(health.nonEntry, 3)
  assert.equal(health.lines, 3)
  assert.equal(health.ratio, 1, '全是非条目 → 占比 100%')
  assert.equal(health.avgEntryBytes, 0, '没有条目，平均条目长度是 0')
  assert.equal(health.bytes, 159)
  assert.ok(health.warnings.length > 0, '全是垃圾时更不能沉默——事故病根就是"看不见垃圾"')
  assert.match(health.warnings[0], /污染/)
  assert.match(health.warnings[0], /100%/, '占比要如实报 100%')
  // entries=0 时第二条（膨胀）判据不成立，只有污染预警 + 建议。
  assert.equal(health.warnings.length, 2)
})

/* ------------------------------------------------------------------ *
 * 5. 字节数精度：UTF-8 字节，不是字符数
 * ------------------------------------------------------------------ */
test('E. 字节口径：中文档案的 bytes 是 UTF-8 字节数，不是字符数', () => {
  const zh = '- [2026-11-13 12:50] 阿依娅伊的记忆库健康度'
  const health = fileHealth(zh)
  assert.equal(health.bytes, 54, '中文一行 = 54 字节')
  assert.equal(health.bytes, Buffer.byteLength(zh, 'utf8'), 'bytes = Buffer.byteLength(raw, utf8)')
  assert.notEqual(health.bytes, zh.length, '54 字节 ≠ 32 字符：把 bytes 写成字符数就错了')
  assert.ok(health.bytes > zh.length, '中文的字节数一定大于字符数')
  // 平均条目字节也走同一口径（trim 后才量长度）。
  assert.equal(health.avgEntryBytes, 54, 'avgEntryBytes 也是字节，不是字符数')
  assert.equal(fileHealth(CLEAN).bytes, 185)
  assert.ok(fileHealth(CLEAN).bytes > CLEAN.length, '185 字节 vs 105 字符')
})

test('E2. 条目字节按 trim 后的行量：行首行尾空白不算进 avgEntryBytes', () => {
  const padded = '\n   - [2026-11-13 12:50] 内容  \n'
  const health = fileHealth(padded)
  assert.equal(health.entries, 1, '行首缩进不影响条目解析')
  assert.equal(health.bytes, 34, '整份文本仍按原样量 34 字节')
  assert.equal(health.avgEntryBytes, 27, '平均条目长度只算 trim 后的 27 字节')
  assert.equal(health.avgEntryBytes, Buffer.byteLength('- [2026-11-13 12:50] 内容', 'utf8'))
})

/* ------------------------------------------------------------------ *
 * 6. 膨胀判据：字节数 > 条目数 × 平均条目长度 × 5
 * ------------------------------------------------------------------ */
test('F. 膨胀档案：条目少、文件被撑大 → 触发第二条预警（阈值 5 倍）', () => {
  const health = fileHealth(HUGE)
  assert.equal(health.entries, 2)
  assert.equal(health.nonEntry, 3)
  assert.equal(health.ratio, 0.6, '垃圾行也拉高占比')
  assert.equal(health.avgEntryBytes, 59)
  assert.equal(health.bytes, 1957)
  assert.equal(health.bytes, Buffer.byteLength(HUGE, 'utf8'))
  const byteWarning = health.warnings.find((w) => w.includes('倍'))
  assert.ok(byteWarning, `必须有"字节数远超条目内容"的那条预警：${JSON.stringify(health.warnings)}`)
  assert.match(byteWarning, /1957 字节/, '要报真实字节数')
  assert.match(byteWarning, /2 条 × 平均 59 字节/, '要报条目内容基准（条目数 × 平均条目长度）')
  assert.match(byteWarning, /阈值 5 倍/, '要把 5 倍阈值说清楚，别让模型自己猜')
  // 两条预警 + 建议 = 3 行。
  assert.equal(health.warnings.length, 3)
  assert.match(health.warnings.at(-1), /^建议：/)
})

test('F2. 5 倍阈值不误伤：垃圾不多时只有污染预警，没有膨胀预警', () => {
  const borderline = [
    '- [2026-11-13 12:50] 用户住在杭州，口味清淡。',
    '一行短垃圾',
  ].join('\n')
  const health = fileHealth(borderline)
  assert.equal(health.ratio, 0.5, '占比超阈值 → 污染预警照出')
  assert.equal(health.bytes, 73)
  assert.equal(health.avgEntryBytes, 57)
  // 条目内容 57 字节 × 5 = 285 > 73 字节 → 不该报"被撑大"。
  assert.equal(health.warnings.some((w) => w.includes('倍')), false, `不该误报膨胀：${JSON.stringify(health.warnings)}`)
  assert.equal(health.warnings.length, 2, '只有污染预警 + 建议')
})

/* ------------------------------------------------------------------ *
 * 7. schema 一致性：HEALTH_SCHEMA ⊇ fileHealth 实际返回的键
 * ------------------------------------------------------------------ */
function fakeCtx() {
  const toolDefs = []
  const ctx = {
    effect(fn) {
      fn()
      return () => {}
    },
    on() {
      return () => {}
    },
    tools: {
      register(def) {
        toolDefs.push(def)
        return () => {}
      },
    },
    systemPrompt: {
      section() {
        return () => {}
      },
    },
  }
  return { ctx, toolDefs }
}

test('G. schema 一致性：fileHealth 返回的每个键都在 HEALTH_SCHEMA.properties 里', () => {
  const { ctx, toolDefs } = fakeCtx()
  apply(ctx)
  const organize = toolDefs.find((def) => def.name === 'memory_organize')
  assert.ok(organize, `memory_organize 应该注册上：${toolDefs.map((d) => d.name)}`)
  const outSchema = organize.output?.schema
  assert.equal(outSchema?.type, 'object')
  const healthSchema = outSchema.properties?.health
  assert.ok(healthSchema, 'output.schema 里要有 health（read 用）')
  assert.equal(healthSchema.type, 'object')
  assert.equal(healthSchema.additionalProperties, false, 'additionalProperties:false → 漏声明一个键，执行期就直接炸')

  const samples = {
    clean: fileHealth(CLEAN),
    polluted: fileHealth(DIRTY),
    empty: fileHealth(''),
    huge: fileHealth(HUGE),
  }
  const declared = Object.keys(healthSchema.properties ?? {})
  const returned = Object.keys(fileHealth(CLEAN))

  // 主闸：返回的键必须都声明了（这正是 precompact_run 踩过的坑）。
  for (const sample of Object.values(samples)) {
    for (const key of Object.keys(sample)) {
      assert.ok(
        Object.hasOwn(healthSchema.properties ?? {}, key),
        `fileHealth 返回了未声明的键 "${key}"（宿主 additionalProperties:false 会拒绝）`,
      )
    }
  }
  // 反向：声明的键都得真的返回，别留"声明了不填"的空壳。
  assert.deepEqual([...declared].sort(), [...returned].sort(), `声明与返回的键集合应一致：声明 ${declared} / 返回 ${returned}`)

  // required 里的键：真实存在且非 undefined。
  for (const key of healthSchema.required ?? []) {
    for (const [label, sample] of Object.entries(samples)) {
      assert.ok(Object.hasOwn(sample, key), `${label} 样本缺 required 键 "${key}"`)
      assert.notEqual(sample[key], undefined, `${label} 样本的 required 键 "${key}" 是 undefined`)
    }
    assert.ok(declared.includes(key), `required 里的 "${key}" 必须同时在 properties 里`)
  }
  // 健康度对象是全字段返回，7 个键都该是 required。
  assert.deepEqual([...(healthSchema.required ?? [])].sort(), [...returned].sort(), 'fileHealth 的字段全是必返，schema 应全部列为 required')

  // 三处引用必须同一份声明（tree 的 coreHealth / tree 的 files[].health / read 的 health）。
  assert.deepEqual(outSchema.properties.coreHealth, healthSchema, 'coreHealth 与 health 必须是同一份声明')
  assert.deepEqual(outSchema.properties.files?.items?.properties?.health, healthSchema, 'files[].health 与 health 必须是同一份声明')

  // 声明的 type 要和真实值对得上（integer / number / string 数组）。
  for (const [key, prop] of Object.entries(healthSchema.properties)) {
    for (const [label, sample] of Object.entries(samples)) {
      const value = sample[key]
      if (prop.type === 'integer') assert.ok(Number.isInteger(value), `${label}.${key} 应为整数，实际 ${value}`)
      else if (prop.type === 'number') assert.ok(Number.isFinite(value), `${label}.${key} 应为数字，实际 ${value}`)
      else if (prop.type === 'array') {
        assert.ok(Array.isArray(value), `${label}.${key} 应为数组，实际 ${value}`)
        assert.ok(value.every((item) => typeof item === 'string'), `${label}.${key} 的每一项应为字符串`)
      } else assert.fail(`HEALTH_SCHEMA.${key} 出现未预期的 type "${prop.type}"`)
    }
  }
})
