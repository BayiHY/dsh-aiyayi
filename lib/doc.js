/**
 * aiyayi-doc — 检索员的本地文档解析工具（只读）。
 *
 * 目的（需求书 2026-11-06 需求一，P0）：检索员要对本地 docx/xlsx/pptx/pdf
 * 提取内容交回，并带定位信息——docx 到段落、xlsx 到工作表+单元格、
 * pptx 到页码、pdf 到页码。只吐内容，不落盘业务文件；检索员的 fs
 * write/edit 锁保持不动（本工具只接收路径、返回文本/图片路径）。
 *
 * 两条实现路线，按格式各自选择：
 * - docx/xlsx/pptx（OOXML，本质是 ZIP+XML）：直接用 node 内建 zlib 解包解析
 *   （document.xml 的 <w:p> 段落、workbook.xml+sharedStrings 的单元格、
 *   slides/slideN 的页），拿到**精确**的段落序号/单元格坐标/页码，零中间产物、
 *   不起子进程。不依赖任何外置 npm 包。
 * - pdf 与旧版二进制 .doc/.xls/.ppt：调 DSH 自带的 LibreOffice Kit
 *   （@deepseek-ai/libreoffice-kit，app.asar.unpacked 磁盘上有完整包+引擎）。
 *   pdf 走 renderImages 出页图（检索员用 read_image 逐页看，识图已实测可用）；
 *   旧版 doc/xls 走 convert 导出 txt/csv 尽力提取（无精确定位，输出里注明）。
 *   Kit 的引入不走去包名解析（本地 bundle 解析不到 shipped 包，坑 #11），
 *   而是 process.resourcesPath / process.execPath 推导出绝对路径后按文件 URL
 *   动态 import——kit 自己的依赖（fflate/koffi/saxes）在同一个 node_modules
 *   树里，从它自身位置能正常解析。
 *
 * 中间产物策略：convert 用的临时目录读完即删；pdf 页图目录保留给 read_image
 * 用（当前会话登记、插件卸载即删，并按"早于 30 分钟"清扫历史残留），目录名
 * aiyayi-doc-pages-* / aiyayi-doc-conv-*，都写在系统临时目录。
 *
 * 错误语义：加密、损坏、不支持的格式一律明确报错，不静默给空结果。
 * 只挂检索员 preset（与 aiyayi-net 同挂法）；本体/小伙伴不挂。
 */
import { registerOwnTool } from './own-tools.js'
import { inflateRawSync } from 'node:zlib'
import { closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

/** Loader 身份。 */
export const name = 'aiyayi-doc'

/** 需要的服务。 */
export const inject = ['tools']

const TEXT_BLOCK = (text) => [{ type: 'text', text }]

/* ================================================================== *
 * LibreOffice Kit 定位与加载（pdf / 旧版格式路线）
 * ================================================================== */

/**Kit 入口的候选路径：显式环境变量 > electron 资源目录 > execPath 推导。 */
function kitCandidates() {
  const rel = join('app.asar.unpacked', 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'index.js')
  const list = []
  if (process.env.DSH_LIBREOFFICE_KIT) list.push(process.env.DSH_LIBREOFFICE_KIT)
  // electron 主进程自带 process.resourcesPath（DSH 桌面版的 resources 目录）。
  if (process.resourcesPath) list.push(join(process.resourcesPath, rel))
  const exeDir = dirname(process.execPath)
  list.push(join(exeDir, 'resources', rel))
  // 兜底：auto-update 布局 exe 在 app-<版本> 子目录里，resources 在上一级。
  list.push(join(dirname(exeDir), 'resources', rel))
  return [...new Set(list.filter(Boolean))]
}

let kitPromise = null

/** 按文件 URL 动态 import Kit（缓存结果；失败给出可读报错）。 */
function loadKit() {
  if (!kitPromise) {
    kitPromise = (async () => {
      let lastErr = null
      for (const p of kitCandidates()) {
        try {
          if (!existsSync(p)) continue
          return await import(pathToFileURL(p).href)
        } catch (e) {
          lastErr = e
        }
      }
      const detail = lastErr ? `（最后一次尝试：${lastErr?.message ?? lastErr}）` : ''
      throw new Error(`内置文档解析引擎（LibreOffice Kit）不可用，pdf 与旧版 doc/xls/ppt 暂时解析不了${detail}。docx/xlsx/pptx 不受影响。`)
    })()
  }
  return kitPromise
}

/** 会话级 converter 单例：Kit 内部对同一 converter 串行排队，天然防并发互踩。 */
let converterPromise = null
function getConverter() {
  if (!converterPromise) {
    converterPromise = loadKit()
      .then((kit) => kit.createConverter({}))
      .catch((e) => {
        converterPromise = null
        throw e
      })
  }
  return converterPromise
}

/** Kit 的 ConversionError.code → 人话。 */
function friendlyKitError(e, context) {
  const code = e?.code
  const table = {
    'invalid-document': '文件损坏或格式不符，解析不了',
    'unsupported-format': '这种格式不支持转换',
    'input-too-large': '文件太大，超出解析引擎上限',
    'output-too-large': '内容太多，请用 range 参数指定更小的区间',
    'invalid-output': '引擎产出的结果无效',
    timeout: '解析超时（文件太大或机器太忙）',
    unavailable: '解析引擎不可用',
    failed: '解析失败',
  }
  const said = table[code] ?? e?.message ?? String(e)
  return new Error(`${context}：${said}${code ? `（${code}）` : ''}`)
}

/* ================================================================== *
 * 最小 ZIP 读取器（OOXML 只读解包）
 * ================================================================== */

const MAX_ZIP_ENTRIES = 4096
const MAX_ENTRY_BYTES = 32 * 1024 * 1024

/**
 * 读 ZIP 中央目录，返回 read(name) 惰性解压函数（附 .names 列表）。
 * 只支持 stored/deflate；ZIP64（>4GB 或 65535+ 条目）明确报错。
 */
function openZip(buf) {
  let eocd = -1
  const floor = Math.max(0, buf.length - 65557)
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 OOXML 包（找不到 ZIP 目录）：文件可能已损坏、被加密，或只是改了名的其他格式')
  const count = buf.readUInt16LE(eocd + 10)
  if (count > MAX_ZIP_ENTRIES) throw new Error(`包内条目过多（${count}），拒绝解析`)
  let ptr = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let n = 0; n < count; n++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('OOXML 包的 ZIP 目录损坏')
    const method = buf.readUInt16LE(ptr + 10)
    const compSize = buf.readUInt32LE(ptr + 20)
    const nameLen = buf.readUInt16LE(ptr + 28)
    const extraLen = buf.readUInt16LE(ptr + 30)
    const commentLen = buf.readUInt16LE(ptr + 32)
    const localOff = buf.readUInt32LE(ptr + 42)
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen)
    if (compSize === 0xffffffff || localOff === 0xffffffff) throw new Error('ZIP64 格式暂不支持（文件太大）')
    entries.set(name, { method, compSize, localOff })
    ptr += 46 + nameLen + extraLen + commentLen
  }
  const read = (name) => {
    const e = entries.get(name)
    if (!e) return null
    const lo = e.localOff
    if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('OOXML 包的 ZIP 局部头损坏')
    const localNameLen = buf.readUInt16LE(lo + 26)
    const localExtraLen = buf.readUInt16LE(lo + 28)
    const start = lo + 30 + localNameLen + localExtraLen
    if (start + e.compSize > buf.length) throw new Error('OOXML 包的数据区越界（文件被截断？）')
    const raw = buf.subarray(start, start + e.compSize)
    if (e.method === 0) return Buffer.from(raw)
    if (e.method === 8) {
      try {
        return inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES })
      } catch (err) {
        if (/maxOutputLength/i.test(String(err?.message))) throw new Error(`包内条目解压后过大（上限 ${MAX_ENTRY_BYTES / 1024 / 1024}MB）：${name}`)
        throw new Error(`条目 ${name} 解压失败：文件可能已损坏`)
      }
    }
    throw new Error(`条目 ${name} 用了不支持的压缩方式 ${e.method}`)
  }
  read.names = [...entries.keys()]
  return read
}

/* ================================================================== *
 * XML 小工具
 * ================================================================== */

function decodeXml(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** 取标签字符串里的属性值（已解码）。 */
function attr(tag, name) {
  const m = String(tag).match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))
  return m ? decodeXml(m[1]) : null
}

/** 文本规整：控制符去掉、连续空白折叠成一个空格。 */
function tidyText(s) {
  return String(s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/* ================================================================== *
 * 区间参数解析
 * ================================================================== */

/** "3-8" / "12" → {min,max}（1 起步、含端点）；非法返回 null。 */
function parseIndexRange(s) {
  const t = String(s ?? '').trim()
  if (!t) return null
  const m = t.match(/^(\d+)(?:\s*-\s*(\d+))?$/)
  if (!m) return null
  const min = parseInt(m[1], 10)
  const max = m[2] !== undefined ? parseInt(m[2], 10) : min
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min) return null
  return { min, max }
}

/** 列字母 → 序号（A=1）。 */
function colToNum(letters) {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

/** xlsx 的 "A1:D200" → {c1,r1,c2,r2}（含端点）；非法返回 null。 */
function parseCellRange(s) {
  const t = String(s ?? '').trim()
  if (!t) return null
  const m = t.match(/^([A-Za-z]+)(\d+)\s*:\s*([A-Za-z]+)(\d+)$/)
  if (!m) return null
  const c1 = colToNum(m[1])
  const r1 = parseInt(m[2], 10)
  const c2 = colToNum(m[3])
  const r2 = parseInt(m[4], 10)
  if (!c1 || !c2 || !r1 || !r2 || r1 > r2) return null
  return { c1: Math.min(c1, c2), c2: Math.max(c1, c2), r1, r2 }
}

/* ================================================================== *
 * docx：段落级提取（word/document.xml 的 <w:p>）
 * ================================================================== */

function extractDocx(read, range) {
  const doc = read('word/document.xml')
  if (!doc) throw new Error('不是有效的 docx（缺少 word/document.xml）')
  const xml = doc.toString('utf8')
  const paras = []
  // <w:p> 不会嵌套在正文段落里（文本框内的段落会被拆成两条，检索摘取场景可接受）。
  for (const m of xml.matchAll(/<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)) {
    const n = paras.length + 1
    const inner = m[0]
      .replace(/<w:tab\b[^>]*\/?>/g, '\t')
      .replace(/<w:br\b[^>]*\/?>/g, '\n')
    let t = ''
    for (const tm of inner.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)) t += tm[1]
    t = tidyText(decodeXml(t))
    if (t) paras.push({ n, text: t })
  }
  if (paras.length === 0) throw new Error('docx 里没有可提取的段落（空文档？）')
  let picked = paras
  if (range) {
    const r = parseIndexRange(range)
    if (!r) throw new Error('docx 的 range 要写段落序号区间，例如 "12-40" 或 "12"')
    picked = paras.filter((p) => p.n >= r.min && p.n <= r.max)
    if (picked.length === 0) throw new Error(`第 ${r.min}-${r.max} 段没有文字（全文共 ${paras.length} 个非空段落）`)
  }
  const text = picked.map((p) => `第${p.n}段｜${p.text}`).join('\n')
  return { kind: 'docx', totalUnits: paras.length, returnedUnits: picked.length, text }
}

/* ================================================================== *
 * xlsx：工作表+单元格级提取（workbook.xml + sharedStrings + sheetN.xml）
 * ================================================================== */

function extractXlsx(read, { sheet, range } = {}) {
  const wb = read('xl/workbook.xml')
  const rels = read('xl/_rels/workbook.xml.rels')
  if (!wb || !rels) throw new Error('不是有效的 xlsx（缺少 workbook.xml 或其关系文件）')
  const relMap = new Map()
  for (const m of rels.toString('utf8').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id')
    const target = attr(m[0], 'Target')
    if (id && target) relMap.set(id, target)
  }
  const sheets = []
  let fallbackIdx = 0
  // 没写 r:id 的生产者兜底：按出现顺序对应 worksheet 类型的关系。
  const worksheetTargets = [...relMap.values()].filter((t) => /worksheets?\//i.test(t))
  for (const m of wb.toString('utf8').matchAll(/<sheet\b[^>]*>/g)) {
    const nm = attr(m[0], 'name')
    const rid = attr(m[0], 'r:id')
    let target = rid ? relMap.get(rid) : null
    if (!target) target = worksheetTargets[fallbackIdx] ?? null
    fallbackIdx += 1
    if (!nm || !target) continue
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^[./]+/, '')}`
    sheets.push({ name: nm, path })
  }
  if (sheets.length === 0) throw new Error('workbook.xml 里找不到工作表')
  let target = sheets[0]
  if (sheet !== undefined && sheet !== null && String(sheet).trim() !== '') {
    const want = String(sheet).trim()
    target = sheets.find((s) => s.name === want)
    if (!target) throw new Error(`没有名为「${want}」的工作表；现有：${sheets.map((s) => `「${s.name}」`).join('、')}`)
  }
  const shared = []
  const ss = read('xl/sharedStrings.xml')
  if (ss) {
    for (const m of ss.toString('utf8').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      let t = ''
      for (const tm of m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) t += tm[1]
      shared.push(decodeXml(t))
    }
  }
  const sx = read(target.path)
  if (!sx) throw new Error(`工作表数据文件缺失：${target.path}`)
  const cellRange = range !== undefined && range !== null && String(range).trim() !== '' ? parseCellRange(range) : null
  if (range && !cellRange) throw new Error('xlsx 的 range 要写单元格区域，例如 "A1:D200"（配合 sheet 参数选表）')
  const lines = []
  let cellCount = 0
  for (const rm of sx.toString('utf8').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowN = parseInt(attr(rm[0], 'r') ?? '0', 10)
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[0], 'r') ?? ''
      const type = attr(cm[0], 't') ?? ''
      const body = cm[2] ?? ''
      const coord = ref.match(/^([A-Z]+)(\d+)$/i)
      if (!coord) continue
      const col = colToNum(coord[1])
      const row = parseInt(coord[2], 10)
      if (cellRange && (col < cellRange.c1 || col > cellRange.c2 || row < cellRange.r1 || row > cellRange.r2)) continue
      let value = ''
      const vm = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)
      if (type === 's') {
        const idx = parseInt(vm?.[1] ?? '', 10)
        value = Number.isSafeInteger(idx) ? (shared[idx] ?? '') : ''
      } else if (type === 'inlineStr') {
        for (const tm of body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) value += tm[1]
        value = decodeXml(value)
      } else if (type === 'b') {
        value = (vm?.[1] ?? '0').trim() === '1' ? 'TRUE' : 'FALSE'
      } else if (type === 'e') {
        value = `#错误(${tidyText(decodeXml(vm?.[1] ?? ''))})`
      } else {
        value = tidyText(decodeXml(vm?.[1] ?? ''))
      }
      value = value.trim()
      if (value === '') continue
      cellCount += 1
      lines.push(`${coord[1].toUpperCase()}${row}｜${value}`)
    }
  }
  if (cellCount === 0) {
    const hint = cellRange ? '该区域内' : ''
    throw new Error(`工作表「${target.name}」${hint}没有非空单元格`)
  }
  const head = `工作表清单：${sheets.map((s) => `「${s.name}」`).join('、')}（当前：${target.name}）`
  const text = `${head}\n${lines.join('\n')}`
  return { kind: 'xlsx', totalUnits: cellCount, returnedUnits: cellCount, text }
}

/* ================================================================== *
 * pptx：页级提取（ppt/slides/slideN.xml）
 * ================================================================== */

function extractPptx(read, range) {
  const slideNames = read.names
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => (parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10)))
  if (slideNames.length === 0) throw new Error('不是有效的 pptx（缺少 ppt/slides/）')
  const r = range ? parseIndexRange(range) : null
  if (range && !r) throw new Error('pptx 的 range 要写页码区间，例如 "3-8"')
  const blocks = []
  let returned = 0
  for (const name of slideNames) {
    const pageNo = parseInt(name.match(/(\d+)\.xml$/)[1], 10)
    if (r && (pageNo < r.min || pageNo > r.max)) continue
    const xml = read(name).toString('utf8')
    const paras = []
    for (const m of xml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)) {
      let t = ''
      for (const tm of m[1].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)) t += tm[1]
      t = tidyText(decodeXml(t))
      if (t) paras.push(t)
    }
    if (paras.length === 0) continue
    returned += 1
    blocks.push(`【第 ${pageNo} 页】\n${paras.map((p) => `  ${p}`).join('\n')}`)
  }
  if (blocks.length === 0) throw new Error(range ? `第 ${r.min}-${r.max} 页没有文字内容` : 'pptx 里没有可提取的文字')
  return { kind: 'pptx', totalUnits: slideNames.length, returnedUnits: returned, text: blocks.join('\n') }
}

/* ================================================================== *
 * pdf：LibreOffice Kit 渲染页图（检索员拿路径用 read_image 逐页看）
 * ================================================================== */

const PDF_DEFAULT_MAX_PAGES = 20

/** 本会话创建的页图目录（dispose 时清掉）；历史残留按 30 分钟清扫。 */
const ownPageDirs = new Set()

function sweepStaleTempDirs() {
  try {
    const now = Date.now()
    for (const name of readdirSync(tmpdir())) {
      if (!/^aiyayi-doc-(pages|conv)-/.test(name)) continue
      const full = join(tmpdir(), name)
      try {
        if (now - statSync(full).mtimeMs > 30 * 60 * 1000) rmSync(full, { recursive: true, force: true })
      } catch {
        /* 别人正用的/已消失的，跳过 */
      }
    }
  } catch {
    /* 清扫失败不影响主流程 */
  }
}

function mapManifestImages(manifest) {
  const images = Array.isArray(manifest) ? manifest : (manifest?.images ?? [])
  return images
    .map((item, idx) => {
      const file = typeof item === 'string' ? item : (item?.file ?? item?.path ?? item?.output ?? null)
      const page = typeof item === 'object' && Number.isSafeInteger(item?.page) ? item.page : idx + 1
      return file ? { page, file: String(file) } : null
    })
    .filter(Boolean)
}

async function renderPdfPages(converter, inputPath, range) {
  const r = range ? parseIndexRange(range) : null
  if (range && !r) throw new Error('pdf 的 range 要写页码区间，例如 "3-8"')
  // Kit 要求 outputDir 是"全新目录"——它自己负责创建/清理（实测预创建会 EEXIST），
  // 所以这里只拼一个唯一名字，不 mkdir。
  const outDir = join(tmpdir(), `aiyayi-doc-pages-${randomUUID().slice(0, 8)}`)
  ownPageDirs.add(outDir)
  const request = { inputPath, outputDir: outDir, dpi: 144, maxPages: r ? 500 : PDF_DEFAULT_MAX_PAGES }
  if (r) request.pages = Array.from({ length: r.max - r.min + 1 }, (_, i) => r.min + i)
  let manifest
  try {
    manifest = await converter.renderImages(request)
  } catch (e) {
    rmSync(outDir, { recursive: true, force: true })
    ownPageDirs.delete(outDir)
    throw friendlyKitError(e, 'PDF 页图渲染失败')
  }
  const pages = mapManifestImages(manifest).map((p) => ({
    page: p.page,
    // manifest 里的路径若为相对路径，对齐到页图目录。
    file: isAbsolute(p.file) ? p.file : join(outDir, p.file),
  }))
  if (pages.length === 0 || !pages.every((p) => existsSync(p.file))) {
    rmSync(outDir, { recursive: true, force: true })
    ownPageDirs.delete(outDir)
    throw new Error('PDF 渲染出了 0 页或页图缺失：文件可能损坏、加密或没有可显示内容')
  }
  const lines = pages.map((p) => `第 ${p.page} 页 → ${p.file}`)
  const text = [
    `已渲染 ${pages.length} 页，页图目录：${outDir}`,
    ...lines,
    '',
    `用 read_image 逐页读图（一次一页，页码就是上面每行开头的编号）。`,
    `这个目录是临时产物：下次解析或约 30 分钟后自动清理，要引用就趁早读。`,
  ].join('\n')
  return { kind: 'pdf', totalUnits: pages.length, returnedUnits: pages.length, text, dir: outDir, pages }
}

/* ================================================================== *
 * 旧版二进制 .doc/.xls/.ppt：convert 导出 txt/csv 尽力提取
 * ================================================================== */

async function convertLegacy(converter, inputPath, ext, { sheet, range } = {}) {
  // convert 只写输出文件、不创建父目录，这里自己建唯一临时目录，读完即删。
  const convDir = join(tmpdir(), `aiyayi-doc-conv-${randomUUID().slice(0, 8)}`)
  mkdirSync(convDir, { recursive: true })
  try {
    const outExt = ext === 'xls' ? 'csv' : 'txt'
    const outputPath = join(convDir, `out.${outExt}`)
    const request = { inputPath, outputPath }
    if (ext === 'xls' && sheet !== undefined && sheet !== null && String(sheet).trim() !== '') {
      request.sheet = String(sheet).trim()
    }
    try {
      await converter.convert(request)
    } catch (e) {
      throw friendlyKitError(e, `${ext} 转换失败（若为加密文档请先解密）`)
    }
    const raw = readFileSync(outputPath, 'utf8')
    const lines = raw
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.replace(/\s+$/, ''))
    // 去掉尾部全空行。
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    if (lines.length === 0) throw new Error(`${ext} 转换后没有内容（空文档或纯图片内容；后者请转存 docx/pptx 后再解析）`)
    const r = range ? parseIndexRange(range) : null
    if (range && !r) throw new Error(`旧版 ${ext} 的 range 要写行号区间，例如 "10-60"（按导出文本的行算）`)
    let picked = lines.map((l, i) => ({ n: i + 1, text: l }))
    if (r) picked = picked.filter((l) => l.n >= r.min && l.n <= r.max)
    const text = picked.map((l) => `第${l.n}行｜${l.text}`).join('\n')
    return {
      kind: 'legacy',
      totalUnits: lines.length,
      returnedUnits: picked.length,
      text,
      note: `旧版二进制 ${ext}：没有段落/单元格级定位，行号按转换出的${ext === 'xls' ? 'CSV' : '纯文本'}行计算；需要精确定位请先转存为 docx/xlsx/pptx。`,
    }
  } finally {
    rmSync(convDir, { recursive: true, force: true })
  }
}

/* ================================================================== *
 * 工具装配
 * ================================================================== */

/** 文本超限截断（保留头部，明确标注截断位置与补救办法）。 */
function capText(text, maxChars) {
  if (text.length <= maxChars) return { text, truncated: false }
  return {
    text: `${text.slice(0, maxChars)}\n…[已截断：本次内容共 ${text.length} 字符，只返回前 ${maxChars}。用 range/sheet 参数取后续区间，别整包重取]`,
    truncated: true,
  }
}

/** 只读文件头 8 字节做格式嗅探，不整读大文件。 */
function sniffMagic(filePath) {
  let fd = null
  try {
    fd = openSync(filePath, 'r')
    const buf = Buffer.alloc(8)
    const bytes = readSync(fd, buf, 0, 8, 0)
    return buf.subarray(0, bytes)
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        /* ignore */
      }
    }
  }
}

const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

async function runDoc(args, converter) {
  const p = String(args?.path ?? '').trim()
  if (!p) throw new Error('aiyayi-doc 需要 path：本地文件的绝对路径')
  if (!isAbsolute(p)) throw new Error('path 必须是绝对路径（例如 D:\\docs\\报告.docx）')
  if (!existsSync(p)) throw new Error(`文件不存在：${p}`)
  const st = statSync(p)
  if (!st.isFile()) throw new Error(`path 不是文件：${p}`)
  if (st.size > 200 * 1024 * 1024) throw new Error(`文件超过 200MB，拒绝解析：${basename(p)}`)
  const range = args?.range === undefined || args?.range === null ? undefined : String(args.range)
  const sheet = args?.sheet === undefined || args?.sheet === null ? undefined : String(args.sheet)
  const maxChars =
    Number.isInteger(args?.maxChars) && args.maxChars > 0 ? Math.min(args.maxChars, 60000) : 16000

  const magic = sniffMagic(p)
  const isZip = magic.length >= 4 && magic[0] === 0x50 && magic[1] === 0x4b
  const isPdf = magic.subarray(0, 5).toString('latin1') === '%PDF-'
  const isOle = magic.length === 8 && magic.equals(OLE_MAGIC)
  const ext = extname(p).slice(1).toLowerCase()

  let result
  if (isZip) {
    // OOXML 路线：按包内部件判型，不吃扩展名的亏。
    const buf = readFileSync(p)
    const read = openZip(buf)
    if (read.names.includes('word/document.xml')) result = extractDocx(read, range)
    else if (read.names.includes('xl/workbook.xml')) result = extractXlsx(read, { sheet, range })
    else if (read.names.includes('ppt/presentation.xml')) result = extractPptx(read, range)
    else throw new Error('是个 ZIP 包但不是 Office 文档（docx/xlsx/pptx）；纯文本请直接用 read，本工具只管 Office 文档与 PDF')
  } else if (isPdf) {
    converter = converter ?? (await getConverter())
    result = await renderPdfPages(converter, p, range)
  } else if (isOle) {
    if (ext === 'doc' || ext === 'xls' || ext === 'ppt') {
      converter = converter ?? (await getConverter())
      result = await convertLegacy(converter, p, ext, { sheet, range })
    } else {
      // OLE 魔数的"现代"扩展名：几乎都是加密的 Office 文档。
      throw new Error(`文件是 OLE 容器但扩展名是 .${ext || '(无)'}：大概率是加密的 Office 文档（打不开就报这个），请先解密；旧版格式请用 .doc/.xls/.ppt 扩展名`)
    }
  } else {
    throw new Error(`无法识别的文件格式（扩展名 .${ext || '(无)'}）：aiyayi-doc 支持 docx/xlsx/pptx/pdf（旧版 doc/xls/ppt 尽力转换）。若这应该是 Office 文档，说明文件内容不是有效的 Office 包——可能损坏、加密或被改了名；纯文本/代码文件请直接用 read`)
  }

  const capped = capText(result.text, maxChars)
  return {
    kind: result.kind,
    file: p,
    totalUnits: result.totalUnits,
    returnedUnits: result.returnedUnits,
    truncated: capped.truncated,
    text: capped.text,
    ...(result.dir ? { dir: result.dir } : {}),
    ...(result.pages ? { pages: result.pages } : {}),
    ...(result.note ? { note: result.note } : {}),
  }
}

/**
 * 注册 aiyayi-doc 到作用域。只在检索员 preset 挂载。
 * @param ctx - preset 作用域内的 agent 上下文。
 */
export function apply(ctx) {
  registerOwnTool(name)

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'aiyayi-doc',
        description:
          '解析本地 Office 文档与 PDF，返回带定位信息的内容：docx 按段落（第N段）、xlsx 按工作表+单元格（A1 坐标）、pptx 按页（第N页）、pdf 按页。docx/xlsx/pptx 直接精确解析；pdf 返回逐页图片路径（配 read_image 逐页看）；旧版 doc/xls/ppt 尽力转出文本（无精确定位）。加密、损坏、不支持的格式会明确报错。只读工具：给它文件路径，它不写任何业务文件。纯文本/代码文件别用它，直接 read。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', description: '要解析的文件绝对路径（支持 docx/xlsx/pptx/pdf，旧版 doc/xls/ppt 尽力）。' },
            range: {
              type: 'string',
              description:
                '可选，定位区间，按格式解释：docx=段落序号区间如 "12-40"；xlsx=单元格区域如 "A1:D200"（配合 sheet）；pptx/pdf=页码区间如 "3-8"；旧版 doc/ppt=导出文本的行号区间。不填=全量（pdf 默认最多前 20 页，更多必须用 range 指定）。',
            },
            sheet: { type: 'string', description: 'xlsx 用：工作表名（精确匹配）。不填默认第一个工作表；报错时会列出全部工作表名。' },
            maxChars: { type: 'integer', description: '返回文本最大字符数，默认 16000、上限 60000；超出会截断并提示改用 range 取后续。' },
          },
          required: ['path'],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', description: 'docx | xlsx | pptx | pdf | legacy' },
              file: { type: 'string' },
              totalUnits: { type: 'integer', description: '全文的段落/单元格/页总数' },
              returnedUnits: { type: 'integer', description: '本次返回的条数' },
              truncated: { type: 'boolean' },
              text: { type: 'string' },
              dir: { type: 'string', description: '仅 pdf：页图临时目录' },
              pages: {
                type: 'array',
                description: '仅 pdf：渲染出的页',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    page: { type: 'integer' },
                    file: { type: 'string' },
                  },
                  required: ['page', 'file'],
                },
              },
              note: { type: 'string' },
            },
            required: ['kind', 'file', 'totalUnits', 'returnedUnits', 'truncated', 'text'],
          },
          render: (_args, value) => {
            const head = [
              `解析 ${value.kind}：${value.file}`,
              `内容 ${value.returnedUnits}/${value.totalUnits} ${value.kind === 'xlsx' ? '个非空单元格' : value.kind === 'docx' ? '个段落' : value.kind === 'pdf' ? '页' : '条'}${value.truncated ? '（已截断）' : ''}`,
            ]
            if (value.note) head.push(value.note)
            return TEXT_BLOCK(`${head.join('\n')}\n--- 内容 ---\n${value.text}`)
          },
        },
        async execute(args) {
          sweepStaleTempDirs()
          // docx/xlsx/pptx 路线用不到 converter；pdf/旧版格式在 runDoc 内按需惰性加载
          //（魔数嗅探决定路线，扩展名只是给报错文案用的）。
          return runDoc(args, null)
        },
      }),
    'aiyayi-doc.register()',
  )

  // 插件卸载（会话结束/重载）时：清掉本会话的页图目录与 converter。
  ctx.effect(
    () => () => {
      for (const dir of ownPageDirs) {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      }
      ownPageDirs.clear()
      if (converterPromise) {
        const p = converterPromise
        converterPromise = null
        p.then((c) => c?.dispose?.()).catch(() => {})
      }
    },
    'aiyayi-doc.cleanup()',
  )
}
