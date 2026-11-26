# -*- coding: utf-8 -*-
r"""edge-tts 晓晓 TTS 桥（dsh-aiyayi skills/tts-setup 随包正本）
监听 127.0.0.1:52123
  GET /tts?text=...[&voice=...][&rate=...]  → 流式 mp3（默认音色 zh-CN-XiaoxiaoNeural）
  GET /health                    → ok
  GET /logs                      → 最近请求日志（时间/文本长度/字节数）
所有响应带 CORS 头（DSH 网页跨源调用）。

依赖：仅 stdlib + pip 包 edge-tts（7.x）。
使用：**别在本技能目录里跑**——插件升级会整目录覆盖同步，运行产生的日志与本地改动都会丢；
      先把本脚本拷到本设备自有工具区再运行。架桥全流程（Windows/Android）见同目录 SKILL.md。
踩坑备忘（多设备实测，别改回）：
  - edge_tts 7.x：edge_tts.Communicate(text, voice).stream_sync() 是**同步生成器**，
    普通 for 迭代；用 async for 会报 __aiter__ 错。
  - 流里混 WordBoundary/SentenceBoundary 元数据块，只收 type=="audio" 的块
    （7.x 块键是小写 {"type","data"}）。
  - 请求收尾**不要调 self.finish()**——会导致 handle_one_request 里 flush
    已关闭文件抛 ValueError；让 http.server 自然收尾即可。
  - pythonw 下 sys.stderr 为 None，BaseHTTPRequestHandler.log_message 会炸，
    必须覆写为空。
运行：pythonw.exe edge_tts_server.py（Windows 无控制台窗口；Android 用 nohup python3）。
拉起：Windows ①WMI Win32_Process.Create 脱 DSH 作业树拉起（父链挂 WmiPrvSE，DSH 重启杀不到）；
      ②开机自启走 HKCU\...\CurrentVersion\Run 键（EdgeTTSBridge，指向 pythonw+本脚本）。
      细节与验活步骤见 SKILL.md。
"""
import collections
import os
import re
import socket
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

HOST = '127.0.0.1'
PORT = 52123
DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural'
MAX_TEXT = 5000
TOOL_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(TOOL_DIR, 'edge_tts_server.log')
LOG_KEEP_LINES = 300

_logs = collections.deque(maxlen=LOG_KEEP_LINES)


def log(msg):
    line = time.strftime('%Y-%m-%d %H:%M:%S') + ' ' + str(msg)
    _logs.append(line)
    try:
        # 日志文件防膨胀：超过 1MB 就截尾到 200KB 再追加
        if os.path.exists(LOG_FILE) and os.path.getsize(LOG_FILE) > 1_000_000:
            with open(LOG_FILE, 'rb') as f:
                f.seek(-200_000, 2)
                tail = f.read()
            with open(LOG_FILE, 'wb') as f:
                f.write(tail)
        with open(LOG_FILE, 'a', encoding='utf-8', errors='replace') as f:
            f.write(line + '\n')
    except Exception:
        pass


def already_running():
    s = socket.socket()
    s.settimeout(1.0)
    try:
        s.connect((HOST, PORT))
        return True
    except OSError:
        return False
    finally:
        try:
            s.close()
        except OSError:
            pass


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'EdgeTTSBridge/1.0'

    def log_message(self, fmt, *args):
        pass  # pythonw 下 stderr 为 None；请求日志走 /logs 自有队列

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')

    def _small(self, code, body, ctype='text/plain; charset=utf-8'):
        data = body.encode('utf-8') if isinstance(body, str) else body
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Content-Length', '0')
        self._cors()
        self.end_headers()

    def do_GET(self):
        try:
            path = urlsplit(self.path).path
            if path == '/health':
                self._small(200, 'ok')
            elif path == '/logs':
                self._small(200, '\n'.join(_logs) or '(no requests yet)')
            elif path == '/tts':
                self.do_tts()
            else:
                self._small(404, 'not found: ' + path)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception as e:
            log('ERROR %s %s: %r' % (self.command, self.path, e))
            try:
                self._small(500, 'bridge error: %r' % (e,))
            except Exception:
                self.close_connection = True

    def do_tts(self):
        qs = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
        text = (qs.get('text') or [''])[0].strip()
        voice = (qs.get('voice') or [DEFAULT_VOICE])[0] or DEFAULT_VOICE
        rate = (qs.get('rate') or [''])[0]  # DSH 客户端固定带 rate=+10%；格式合法才透传
        if not re.fullmatch(r'[+-]\d{1,3}%', rate):
            rate = ''
        t0 = time.time()
        if not text:
            self._small(400, '{"error":"empty text"}', 'application/json; charset=utf-8')
            return
        if len(text) > MAX_TEXT:
            self._small(400, '{"error":"text too long (max %d)"}' % MAX_TEXT,
                        'application/json; charset=utf-8')
            return
        try:
            import edge_tts  # 延迟导入：/health /logs 不依赖它也能活
            kwargs = {'rate': rate} if rate else {}
            comm = edge_tts.Communicate(text, voice, **kwargs)
            gen = comm.stream_sync()  # 同步生成器，普通 for 迭代
        except Exception as e:
            log('TTS init fail text_len=%d: %r' % (len(text), e))
            self._small(502, '{"error":"tts init failed"}', 'application/json; charset=utf-8')
            return
        self.send_response(200)
        self.send_header('Content-Type', 'audio/mpeg')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Transfer-Encoding', 'chunked')
        self._cors()
        self.end_headers()
        total = 0
        try:
            for chunk in gen:
                if chunk.get('type') != 'audio':  # 只收音频块，元数据块跳过
                    continue
                data = chunk.get('data') or b''
                if not data:
                    continue
                self.wfile.write(b'%x\r\n' % len(data))
                self.wfile.write(data)
                self.wfile.write(b'\r\n')
                total += len(data)
            self.wfile.write(b'0\r\n\r\n')  # chunked 终止块；之后不调 finish()
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
            log('TTS client aborted mid-stream bytes=%d text_len=%d' % (total, len(text)))
            return
        except Exception as e:
            self.close_connection = True
            log('TTS stream fail after %d bytes text_len=%d: %r' % (total, len(text), e))
            return
        dt = (time.time() - t0) * 1000.0
        log('TTS voice=%s rate=%s text_len=%d bytes=%d %.0fms' % (voice, rate or '-', len(text), total, dt))


class Server(ThreadingHTTPServer):
    daemon_threads = True


def main():
    if already_running():
        log('another instance already listening, exit')
        sys.exit(0)
    log('bridge start pid=%d voice=%s' % (os.getpid(), DEFAULT_VOICE))
    srv = Server((HOST, PORT), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
