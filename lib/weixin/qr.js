/**
 * 二维码生成（零 npm 依赖）。
 *
 * 为什么自带实现：官方插件用 qrcode-terminal，本插件零外部依赖（4.9 阶段 4 红线）。
 * QRCode 核心是从 qrcode-terminal@0.12.0 内联来的（MIT，Kazuhiko Arase / soldair），
 * 放在 vendor/QRCode/，同目录 package.json 声明 CommonJS 作用域（坑 6：包根是
 * type=module，不划作用域的话 .js 会被当 ESM 解析，require 全失效）。
 *
 * 用 createRequire 在运行时 require，不 import。
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.join(HERE, 'qr.js'))

let cachedCore = null
function loadCore() {
  if (cachedCore) return cachedCore
  const QRCode = require('./vendor/QRCode')
  const levels = require('./vendor/QRCode/QRErrorCorrectLevel')
  cachedCore = { QRCode, levelL: levels.L }
  return cachedCore
}

/**
 * 生成二维码模块矩阵：true = 黑。
 * @param {string} text
 * @returns {boolean[][]}
 */
export function buildMatrix(text) {
  const { QRCode, levelL } = loadCore()
  const qr = new QRCode(-1, levelL)
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  const modules = []
  for (let r = 0; r < n; r++) {
    const row = new Array(n)
    for (let c = 0; c < n; c++) row[c] = qr.isDark(r, c)
    modules.push(row)
  }
  return modules
}

/** 终端半块字符渲染（只在交互式 login 命令里用；插件路径用 PNG）。 */
export function renderTerminal(modules) {
  const n = modules.length
  const UP = '\u2580'
  const DOWN = '\u2584'
  const FULL = '\u2588'
  const blank = ' '
  const pad = 2
  const lines = []
  const at = (r, c) => (r < 0 || r >= n || c < 0 || c >= n ? false : modules[r][c])
  for (let i = 0; i < pad; i++) lines.push('  '.repeat(n + pad * 2))
  for (let r = 0; r < n; r += 2) {
    let line = '  '.repeat(pad)
    for (let c = 0; c < n; c++) {
      const top = at(r, c)
      const bottom = at(r + 1, c)
      if (top && bottom) line += FULL + FULL
      else if (top && !bottom) line += UP + UP
      else if (!top && bottom) line += DOWN + DOWN
      else line += blank + blank
    }
    line += '  '.repeat(pad)
    lines.push(line)
  }
  for (let i = 0; i < pad; i++) lines.push('  '.repeat(n + pad * 2))
  return lines.join('\n')
}

// ─── PNG（零依赖：手写 chunk + zlib） ───────────────────────────────────────

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
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

/**
 * 把模块矩阵写成 1-bit 灰度 PNG。
 * @param {boolean[][]} modules
 * @param {{scale?: number, quietZone?: number, invert?: boolean}} opts
 * @returns {Buffer}
 */
export function encodePng(modules, { scale = 8, quietZone = 4, invert = false } = {}) {
  const n = modules.length
  const size = (n + quietZone * 2) * scale
  const px = new Uint8Array(size * size)
  px.fill(invert ? 0 : 255)
  const blackVal = invert ? 255 : 0
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!modules[r][c]) continue
      const x0 = (c + quietZone) * scale
      const y0 = (r + quietZone) * scale
      for (let dy = 0; dy < scale; dy++) {
        const rowStart = (y0 + dy) * size
        for (let dx = 0; dx < scale; dx++) px[rowStart + x0 + dx] = blackVal
      }
    }
  }
  const rawStride = size + 1
  const raw = Buffer.alloc(rawStride * size)
  for (let y = 0; y < size; y++) {
    raw[y * rawStride] = 0
    raw.set(px.subarray(y * size, (y + 1) * size), y * rawStride + 1)
  }
  const idatData = zlib.deflateSync(raw, { level: 9 })
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // color type 0 = grayscale
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 一步到位：URL/文本 → PNG Buffer。 */
export function renderPng(text, opts = {}) {
  return encodePng(buildMatrix(text), opts)
}
