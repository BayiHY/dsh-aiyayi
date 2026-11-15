/**
 * aiyayi-doc 测试（1.8）：本地 Office 文档解析工具的 schema 闸 + 解析行为 + 错误路径。
 *
 * 为什么要有这个文件：`lib/doc.js`（707 行）注册 `aiyayi-doc`，做 docx/xlsx/pptx/pdf
 * 的本地提取，之前零测试覆盖；现有的 tools-surface schema 闸只加载 index.js +
 * presence.js，够不着它（注册不上或 schema 不合规会静默失败，见 README 坑 #1）。
 *
 * 怎么测：照 `tools-surface.test.mjs` 的老办法——用假 ctx 走一遍真实 `apply()`，
 * 把注册的工具定义拿到手，然后直接调它的 `execute()`。所有解析样本都在**代码里
 * 现场生成**（一个 80 行的 stored-ZIP writer + 手写 OOXML），不提交任何二进制
 * fixture，也不写仓库目录，全落在 os.tmpdir() 的临时沙盘里。
 *
 * 覆盖：
 *  - schema 闸：工具名/参数 schema/output.schema/render/own-tools 放行；
 *  - docx：段落提取与"第N段"定位、XML 实体解码、tab/br 转空格、range 区间与非法 range；
 *  - xlsx：多工作表、A1 坐标、共享字符串、数值/布尔/内联串/错误四种单元格类型、
 *    sheet 选表与不存在的表、range 单元格区域；
 *  - pptx：按页提取、页码按**数字**排序（slide10 不能排到 slide2 前面）、range 取页；
 *  - maxChars：截断提示、上限 60000、非法值回落默认 16000；
 *  - 错误路径：缺 path / 相对路径 / 不存在 / 是目录 / 无法识别格式 / ZIP 但不是
 *    Office / OLE 魔数配现代扩展名（加密文档）/ 损坏 ZIP（无目录、局部头坏、
 *    ZIP64、不支持的压缩方式）/ 空 docx。
 *
 * 不测（见文件末注释）：pdf 与旧版 doc/xls/ppt 的真实解析——那两条路线要
 * LibreOffice Kit，属于外部引擎，结果取决于机器上有没有装，单测里留成外部依赖
 * 会让这个文件在别人机器上假红。它们的分支只验到"参数/格式判型"这一层。
 *
 * 跑法：node --test test/doc.test.mjs（可单跑，不依赖其他测试文件）
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const libUrl = (file) => pathToFileURL(join(HERE, '..', 'lib', file)).href

/* ================================================================== *
 * 最小 ZIP writer：只写 stored（不压缩）条目，产出合法 ZIP。
 * 只为"样本能现场生成"服务——不引入 yazl/archiver 之类外置依赖。
 * ================================================================== */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/**
 * @param {Record<string, string>} files 条目名 → 文本内容
 * @returns {{ buffer: Buffer, centralDirOffset: number, entryCount: number }}
 */
function makeZip(files) {
  const names = Object.keys(files)
  const locals = []
  const centrals = []
  let offset = 0
  for (const name of names) {
    const data = Buffer.from(files[name], 'utf8')
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(0, 8) // method 0 = stored
    local.writeUInt16LE(0, 10) // mod time
    local.writeUInt16LE(0, 12) // mod date
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18) // comp size
    local.writeUInt32LE(data.length, 22) // uncomp size
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra len
    locals.push(local, nameBuf, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0, 8) // flags
    central.writeUInt16LE(0, 10) // method
    central.writeUInt16LE(0, 12) // mod time
    central.writeUInt16LE(0, 14) // mod date
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk start
    central.writeUInt16LE(0, 36) // internal attr
    central.writeUInt32LE(0, 38) // external attr
    central.writeUInt32LE(offset, 42) // local header offset
    centrals.push(central, nameBuf)

    offset += 30 + nameBuf.length + data.length
  }

  const localPart = Buffer.concat(locals)
  const centralPart = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4) // disk num
  eocd.writeUInt16LE(0, 6) // cd start disk
  eocd.writeUInt16LE(names.length, 8)
  eocd.writeUInt16LE(names.length, 10)
  eocd.writeUInt32LE(centralPart.length, 12)
  eocd.writeUInt32LE(localPart.length, 16) // cd offset == local part size
  eocd.writeUInt16LE(0, 20)

  return {
    buffer: Buffer.concat([localPart, centralPart, eocd]),
    centralDirOffset: localPart.length,
    entryCount: names.length,
  }
}

/* ================================================================== *
 * 样本构造（全部现场生成）
 * ================================================================== */

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** word/document.xml 放在**第一个**条目上（损坏测试要按 local offset 篡改它）。 */
function makeDocx(bodyXml) {
  return makeZip({
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W_NS}"><w:body>${bodyXml}</w:body></w:document>`,
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
  })
}

const PARA = (text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`

function makeXlsx() {
  return makeZip({
    'xl/workbook.xml':
      `<?xml version="1.0"?><workbook xmlns="${W_NS}" xmlns:r="${REL_NS}"><sheets>` +
      '<sheet name="数据" sheetId="1" r:id="rId1"/>' +
      '<sheet name="第二页" sheetId="2" r:id="rId2"/>' +
      '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      `<?xml version="1.0"?><Relationships xmlns="${REL_NS}">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
      '</Relationships>',
    'xl/sharedStrings.xml':
      '<?xml version="1.0"?><sst><si><t>姓名</t></si><si><t>金额 &amp; 备注</t></si></sst>',
    'xl/worksheets/sheet1.xml':
      '<?xml version="1.0"?><worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2"><v>42</v></c><c r="B2" t="b"><v>1</v></c><c r="C2" t="b"><v>0</v></c></row>' +
      '<row r="3"><c r="A3" t="inlineStr"><is><t>内联文本</t></is></c><c r="C3" t="e"><v>#DIV/0!</v></c></row>' +
      '<row r="4"><c r="A4"><v></v></c></row>' +
      '</sheetData></worksheet>',
    'xl/worksheets/sheet2.xml':
      '<?xml version="1.0"?><worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>第二页内容</t></is></c></row>' +
      '</sheetData></worksheet>',
  })
}

const slide = (text) =>
  `<?xml version="1.0"?><p:sld xmlns:p="${P_NS}" xmlns:a="${A_NS}"><p:cSld><p:spTree><p:sp><p:txBody>` +
  `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>` +
  `</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`

function makePptx() {
  return makeZip({
    'ppt/presentation.xml': `<?xml version="1.0"?><p:presentation xmlns:p="${P_NS}"/>`,
    'ppt/slides/slide1.xml': slide('第一页标题'),
    'ppt/slides/slide2.xml': slide('第二页标题'),
    'ppt/slides/slide10.xml': slide('第十页标题'),
  })
}

/* ================================================================== *
 * 沙盘 + 假 ctx（照 tools-surface 的写法）
 * ================================================================== */

const sandbox = mkdtempSync(join(tmpdir(), 'aiyayi-doc-test-'))
process.on('exit', () => {
  try {
    rmSync(sandbox, { recursive: true, force: true })
  } catch {
    /* 清理失败不该盖掉真正的测试结果 */
  }
})

function writeTemp(name, content) {
  const p = join(sandbox, name)
  writeFileSync(p, content)
  return p
}

const toolDefs = []
const makeCtx = () => ({
  effect(fn) {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  tools: {
    register(def) {
      toolDefs.push(def)
      return () => {}
    },
  },
})

const docModule = await import(libUrl('doc.js'))
const { isOwnTool } = await import(libUrl('own-tools.js'))
docModule.apply(makeCtx())

const doc = toolDefs.find((def) => def.name === 'aiyayi-doc')

/* ================================================================== *
 * 一、schema 闸
 * ================================================================== */

test('模块身份：name / inject / 注册的工具名', () => {
  assert.equal(docModule.name, 'aiyayi-doc')
  assert.deepEqual(docModule.inject, ['tools'])
  assert.ok(doc, 'apply() 应该注册 aiyayi-doc')
  assert.equal(doc.name, 'aiyayi-doc')
})

test('schema 闸：parameters 是标准 JSON Schema 形状', () => {
  const params = doc.parameters
  assert.equal(params.type, 'object')
  assert.equal(params.additionalProperties, false)
  assert.deepEqual(params.required, ['path'])
  assert.deepEqual(Object.keys(params.properties).sort(), ['maxChars', 'path', 'range', 'sheet'])
  // 坑 #1：把 required 塞进属性里会让激活静默失败。
  for (const prop of Object.values(params.properties)) assert.equal(prop.required, undefined)
})

test('schema 闸：每个参数的 type 与描述都在', () => {
  const { path, range, sheet, maxChars } = doc.parameters.properties
  assert.equal(path.type, 'string')
  assert.equal(range.type, 'string')
  assert.equal(sheet.type, 'string')
  assert.equal(maxChars.type, 'integer')
  for (const prop of [path, range, sheet, maxChars]) {
    assert.equal(typeof prop.description, 'string')
    assert.ok(prop.description.length > 0)
  }
  // 描述里点明了"绝对路径"和各格式的 range 语义，模型才用得住。
  assert.match(path.description, /绝对路径/)
  assert.match(range.description, /docx=/)
  assert.match(range.description, /xlsx=/)
  assert.match(range.description, /pptx\/pdf=/)
})

test('schema 闸：output.schema 的 required 都在 properties 里，且 render 是函数', () => {
  const schema = doc.output.schema
  assert.equal(schema.type, 'object')
  assert.equal(schema.additionalProperties, false)
  const props = Object.keys(schema.properties)
  for (const key of schema.required) assert.ok(props.includes(key), `required 里的 ${key} 不在 properties`)
  assert.deepEqual(schema.required, ['kind', 'file', 'totalUnits', 'returnedUnits', 'truncated', 'text'])
  assert.equal(typeof doc.output.render, 'function')
  assert.deepEqual(doc.output.schema.properties.kind.description.split(' | '), ['docx', 'xlsx', 'pptx', 'pdf', 'legacy'])
})

test('own-tools 白名单放行 aiyayi-doc（restrict 不会收掉它）', () => {
  assert.equal(isOwnTool('aiyayi-doc'), true)
})

/* ================================================================== *
 * 二、docx：段落级提取
 * ================================================================== */

test('docx：按段落提取，带"第N段"定位，实体解码，空白折叠', async () => {
  const p = writeTemp(
    'basic.docx',
    makeDocx(
      PARA('第一段 &amp; 实体 &lt;tag&gt;') +
        '<w:p><w:r><w:t>制表</w:t></w:r><w:r><w:tab/><w:t>后面</w:t></w:r></w:p>' +
        PARA('   多   空格   '),
    ).buffer,
  )
  const out = await doc.execute({ path: p })
  assert.equal(out.kind, 'docx')
  assert.equal(out.file, p)
  assert.equal(out.totalUnits, 3)
  assert.equal(out.returnedUnits, 3)
  assert.equal(out.truncated, false)
  assert.equal(out.text, '第1段｜第一段 & 实体 <tag>\n第2段｜制表 后面\n第3段｜多 空格')
})

test('docx：<w:tab/> / <w:br/> 转成空格，不再粘词', async () => {
  /*
   * extractDocx() 按文档顺序遍历段落内部元素：<w:t> 取文本，<w:tab/> 和 <w:br/>
   * 各补一个分隔空格（它们是 <w:t> 的兄弟元素，不能只从 <w:t> 里收集，否则
   * "制<tab/>表"会粘成"制表"）。多余空格由 tidyText() 折叠，段落首尾的空白被 trim。
   */
  const p = writeTemp(
    'tab.docx',
    makeDocx(
      '<w:p><w:r><w:t>制表</w:t><w:tab/><w:t>后面</w:t><w:br/><w:t>换行后</w:t></w:r></w:p>' +
        // 边界：tab/br 落在段落开头、结尾，以及连续多个。
        '<w:p><w:r><w:tab/><w:t>开头是tab</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>结尾是tab</w:t><w:tab/><w:tab/></w:r></w:p>' +
        '<w:p><w:r><w:t>甲</w:t><w:tab/><w:br/><w:tab/><w:t>乙</w:t></w:r></w:p>',
    ).buffer,
  )
  const out = await doc.execute({ path: p })
  assert.equal(
    out.text,
    '第1段｜制表 后面 换行后\n第2段｜开头是tab\n第3段｜结尾是tab\n第4段｜甲 乙',
  )
  assert.equal(out.totalUnits, 4)
})

test('docx：空段落不占编号（编号以非空段落连续计，range 也按这个编号）', async () => {
  const p = writeTemp('blank-para.docx', makeDocx(PARA('甲') + '<w:p/>' + PARA('乙')).buffer)
  const out = await doc.execute({ path: p })
  // 第 2 个 <w:p> 是空段落，被跳过；第 3 个 <w:p> 因此被标成"第2段"。
  // 全文自洽（range 也按同一套编号），但与 Word 里的段落号会差一个——记录下来。
  assert.equal(out.text, '第1段｜甲\n第2段｜乙')
  assert.equal(out.totalUnits, 2)
})

test('docx：range 取区间（含端点）', async () => {
  const p = writeTemp('range.docx', makeDocx(PARA('一') + PARA('二') + PARA('三')).buffer)
  const out = await doc.execute({ path: p, range: '2-3' })
  assert.equal(out.text, '第2段｜二\n第3段｜三')
  assert.equal(out.returnedUnits, 2)
  assert.equal(out.totalUnits, 3)
})

test('docx：range 写单个数字时只取那一段', async () => {
  const p = writeTemp('range-one.docx', makeDocx(PARA('一') + PARA('二')).buffer)
  const out = await doc.execute({ path: p, range: '2' })
  assert.equal(out.text, '第2段｜二')
})

test('docx：非法 range 明确报错（不是静默给空结果）', async () => {
  const p = writeTemp('range-bad.docx', makeDocx(PARA('一')).buffer)
  await assert.rejects(() => doc.execute({ path: p, range: 'abc' }), /range 要写段落序号区间/)
  await assert.rejects(() => doc.execute({ path: p, range: '0-1' }), /range 要写段落序号区间/)
  await assert.rejects(() => doc.execute({ path: p, range: '3-2' }), /range 要写段落序号区间/)
})

test('docx：range 超出范围时报错并给出全文段落数', async () => {
  const p = writeTemp('range-over.docx', makeDocx(PARA('一') + PARA('二')).buffer)
  await assert.rejects(() => doc.execute({ path: p, range: '9-10' }), /第 9-10 段没有文字（全文共 2 个非空段落）/)
})

test('docx：maxChars 截断并提示改用 range', async () => {
  const p = writeTemp('cap.docx', makeDocx(PARA('一段很长的内容'.repeat(50))).buffer)
  const out = await doc.execute({ path: p, maxChars: 40 })
  assert.equal(out.truncated, true)
  assert.match(out.text, /已截断/)
  assert.match(out.text, /只返回前 40/)
  assert.match(out.text, /range/)
  assert.ok(out.text.length < 200, `截断后不该还这么长：${out.text.length}`)
})

test('docx：maxChars 硬上限 60000（传更大也只给 6 万）', async () => {
  const p = writeTemp('cap-limit.docx', makeDocx(PARA('a'.repeat(70000))).buffer)
  const out = await doc.execute({ path: p, maxChars: 999999 })
  assert.equal(out.truncated, true)
  assert.match(out.text, /只返回前 60000/)
  assert.ok(out.text.length < 60200, `上限应是 60000，实际 ${out.text.length}`)
  assert.ok(out.text.startsWith('第1段｜aaa'))
})

test('docx：maxChars 非法值回落默认 16000', async () => {
  const p = writeTemp('cap-default.docx', makeDocx(PARA('b'.repeat(20000))).buffer)
  for (const bad of [0, -5, '300', 1.5]) {
    const out = await doc.execute({ path: p, maxChars: bad })
    assert.equal(out.truncated, true, `maxChars=${bad} 应回落到默认值`)
    assert.match(out.text, /只返回前 16000/)
  }
})

test('docx：render 给出模型看到的头部摘要', async () => {
  const p = writeTemp('render.docx', makeDocx(PARA('一') + PARA('二')).buffer)
  const out = await doc.execute({ path: p })
  const blocks = doc.output.render({}, out)
  assert.ok(Array.isArray(blocks))
  assert.equal(blocks[0].type, 'text')
  assert.match(blocks[0].text, /解析 docx：/)
  assert.match(blocks[0].text, /内容 2\/2 个段落/)
  assert.match(blocks[0].text, /--- 内容 ---/)
})

/* ================================================================== *
 * 三、xlsx：工作表 + 单元格
 * ================================================================== */

test('xlsx：默认第一个工作表，输出 A1 坐标与共享字符串', async () => {
  const p = writeTemp('sheet.xlsx', makeXlsx().buffer)
  const out = await doc.execute({ path: p })
  assert.equal(out.kind, 'xlsx')
  assert.ok(out.text.startsWith('工作表清单：「数据」、「第二页」（当前：数据）'), out.text)
  assert.match(out.text, /A1｜姓名/)
  assert.match(out.text, /B1｜金额 & 备注/) // 共享字符串里的 &amp; 要解码
  assert.match(out.text, /A2｜42/)
})

test('xlsx：四种单元格类型（数值/布尔/内联串/错误）都按人话输出', async () => {
  const p = writeTemp('types.xlsx', makeXlsx().buffer)
  const out = await doc.execute({ path: p })
  assert.match(out.text, /B2｜TRUE/)
  assert.match(out.text, /C2｜FALSE/)
  assert.match(out.text, /A3｜内联文本/)
  assert.match(out.text, /C3｜#错误\(#DIV\/0!\)/)
  // 空 <v> 的单元格不进结果（A4 不出现）。
  assert.ok(!out.text.includes('A4'), out.text)
})

test('xlsx：sheet 参数按名选表，选不到时列出全部表名', async () => {
  const p = writeTemp('sheet-pick.xlsx', makeXlsx().buffer)
  const second = await doc.execute({ path: p, sheet: '第二页' })
  assert.match(second.text, /（当前：第二页）/)
  assert.match(second.text, /A1｜第二页内容/)
  assert.ok(!second.text.includes('姓名'), second.text)

  await assert.rejects(() => doc.execute({ path: p, sheet: '不存在的表' }), /没有名为「不存在的表」的工作表；现有：「数据」、「第二页」/)
})

test('xlsx：range 限定单元格区域（列/行都要真过滤）', async () => {
  const p = writeTemp('sheet-range.xlsx', makeXlsx().buffer)
  const out = await doc.execute({ path: p, range: 'A1:A2' })
  assert.match(out.text, /A1｜姓名/)
  assert.match(out.text, /A2｜42/)
  assert.ok(!out.text.includes('B1'), out.text)
  assert.ok(!out.text.includes('A3'), out.text)
  assert.equal(out.returnedUnits, 2)
})

test('xlsx：非法 range 与反向区域都明确报错', async () => {
  const p = writeTemp('sheet-range-bad.xlsx', makeXlsx().buffer)
  await assert.rejects(() => doc.execute({ path: p, range: 'A1' }), /range 要写单元格区域/)
  await assert.rejects(() => doc.execute({ path: p, range: '随便写' }), /range 要写单元格区域/)
  await assert.rejects(() => doc.execute({ path: p, range: 'A3:A2' }), /range 要写单元格区域/)
})

test('xlsx：range 区域内没有非空单元格时报错（不静默给空）', async () => {
  const p = writeTemp('sheet-empty-range.xlsx', makeXlsx().buffer)
  await assert.rejects(() => doc.execute({ path: p, range: 'Z90:Z99' }), /该区域内没有非空单元格/)
})

/* ================================================================== *
 * 四、pptx：页级提取
 * ================================================================== */

test('pptx：按页提取，页码按数字排序（slide10 排在 slide2 后面）', async () => {
  const p = writeTemp('slides.pptx', makePptx().buffer)
  const out = await doc.execute({ path: p })
  assert.equal(out.kind, 'pptx')
  const pages = [...out.text.matchAll(/【第 (\d+) 页】/g)].map((m) => Number(m[1]))
  assert.deepEqual(pages, [1, 2, 10])
  assert.match(out.text, /【第 1 页】\n  第一页标题/)
  assert.equal(out.totalUnits, 3)
  assert.equal(out.returnedUnits, 3)
})

test('pptx：range 取页区间，超出范围报错', async () => {
  const p = writeTemp('slides-range.pptx', makePptx().buffer)
  const out = await doc.execute({ path: p, range: '2-2' })
  assert.match(out.text, /【第 2 页】/)
  assert.ok(!out.text.includes('第一页标题'), out.text)
  await assert.rejects(() => doc.execute({ path: p, range: 'abc' }), /pptx 的 range 要写页码区间/)
  await assert.rejects(() => doc.execute({ path: p, range: '8-9' }), /第 8-9 页没有文字内容/)
})

/* ================================================================== *
 * 五、错误路径
 * ================================================================== */

test('错误路径：缺 path / 相对路径 / 文件不存在 / 路径是目录', async () => {
  await assert.rejects(() => doc.execute({}), /需要 path/)
  await assert.rejects(() => doc.execute({ path: '   ' }), /需要 path/)
  await assert.rejects(() => doc.execute({ path: 'sub/dir/a.docx' }), /必须是绝对路径/)
  await assert.rejects(() => doc.execute({ path: join(sandbox, 'nope.docx') }), /文件不存在/)
  mkdirSync(join(sandbox, 'a-dir'), { recursive: true })
  await assert.rejects(() => doc.execute({ path: join(sandbox, 'a-dir') }), /path 不是文件/)
})

test('错误路径：无法识别的格式（纯文本别用它）', async () => {
  const p = writeTemp('plain.txt', 'hello world, 这不是 Office 文档\n')
  await assert.rejects(() => doc.execute({ path: p }), /无法识别的文件格式（扩展名 \.txt）/)
  await assert.rejects(() => doc.execute({ path: p }), /纯文本\/代码文件请直接用 read/)

  const noExt = writeTemp('noext', 'abc')
  await assert.rejects(() => doc.execute({ path: noExt }), /扩展名 \.\(无\)/)
})

test('错误路径：是 ZIP 但不是 Office 包', async () => {
  const { buffer } = makeZip({ 'mimetype': 'application/epub+zip' })
  const p = writeTemp('not-office.zip', buffer)
  await assert.rejects(() => doc.execute({ path: p }), /是个 ZIP 包但不是 Office 文档/)
})

test('错误路径：OLE 魔数配现代扩展名 → 提示大概率是加密文档', async () => {
  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])
  const p = writeTemp('encrypted.docx', ole)
  await assert.rejects(() => doc.execute({ path: p }), /OLE 容器但扩展名是 \.docx/)
  await assert.rejects(() => doc.execute({ path: p }), /大概率是加密的 Office 文档/)
})

test('错误路径：损坏的 ZIP —— 找不到中央目录', async () => {
  const p = writeTemp('broken.docx', Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(60, 0x41)]))
  await assert.rejects(() => doc.execute({ path: p }), /不是有效的 OOXML 包（找不到 ZIP 目录）/)
})

test('错误路径：损坏的 ZIP —— 局部头坏了', async () => {
  // 注意：文件头 4 字节必须还是 "PK"，否则先被魔数嗅探判成"无法识别格式"，
  // 走不到 ZIP 解析。所以这里让 word/document.xml 当**第二个**条目，
  // 再抹掉它的局部头签名——中央目录完好（条目能找到），读数据时才报损坏。
  const { buffer } = makeZip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="${W_NS}"><w:body>${PARA('一')}</w:body></w:document>`,
  })
  const broken = Buffer.from(buffer)
  const second = broken.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 4)
  assert.ok(second > 0, '样本里应该有第二个局部头')
  broken.writeUInt32LE(0x00000000, second)
  await assert.rejects(() => doc.execute({ path: writeTemp('broken-local.docx', broken) }), /ZIP 局部头损坏/)
})

test('错误路径：损坏的 ZIP —— ZIP64 与不支持的压缩方式都明确拒绝', async () => {
  const { buffer, centralDirOffset } = makeDocx(PARA('一'))

  const zip64 = Buffer.from(buffer)
  zip64.writeUInt32LE(0xffffffff, centralDirOffset + 20) // 中央目录第一项的 compSize
  await assert.rejects(() => doc.execute({ path: writeTemp('zip64.docx', zip64) }), /ZIP64 格式暂不支持/)

  const weird = Buffer.from(buffer)
  weird.writeUInt16LE(12, centralDirOffset + 10) // method 12：bzip2，不在支持列表
  await assert.rejects(() => doc.execute({ path: writeTemp('method.docx', weird) }), /用了不支持的压缩方式 12/)
})

test('错误路径：docx 里没有可提取的段落', async () => {
  const p = writeTemp('empty.docx', makeDocx('<w:p><w:pPr/></w:p>').buffer)
  await assert.rejects(() => doc.execute({ path: p }), /没有可提取的段落（空文档？）/)
})

test('apply() 注册了两个 effect（注册 + 卸载清理），清理函数可重复调用', () => {
  const disposers = []
  const ctx = {
    effect(fn) {
      const dispose = fn()
      disposers.push(typeof dispose === 'function' ? dispose : () => {})
      return () => {}
    },
    tools: { register: () => () => {} },
  }
  docModule.apply(ctx)
  assert.equal(disposers.length, 2)
  for (const dispose of disposers) {
    assert.doesNotThrow(() => dispose())
    assert.doesNotThrow(() => dispose()) // 重复卸载不该炸
  }
})

/*
 * 没测的部分（不是漏测，是刻意留给外部依赖）：
 *  - pdf：`renderPdfPages()` 要 LibreOffice Kit 的 renderImages()，产页图到临时目录。
 *    这条路线依赖机器上有没有 shipped kit（DSH_LIBREOFFICE_KIT / app.asar.unpacked），
 *    写进来会让这个文件在别人机器上假红，所以只验到格式判型层（见上面 OLE/ZIP 的用例）。
 *  - 旧版 .doc/.xls/.ppt：同理，走 kit 的 convert()。
 *  - 200MB 大小闸：造不出也不该造这么大的样本，跳过。
 */
