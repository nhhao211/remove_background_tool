import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Keeps one long-lived `python/worker.py` process and talks to it over
 * stdin/stdout with length-prefixed frames (see python/rmbg/protocol.py):
 *
 *   u32le bodyLength | u32le headerLength | header JSON | payload bytes
 *
 * The HTTP endpoint uses the same *body* layout, so a request from the browser
 * is forwarded to the worker without copying pixels into JSON or base64.
 *
 * The worker is optional. Nothing starts it until the first request, a crash
 * rejects whatever was in flight and the next request starts a fresh one, and
 * a missing interpreter or missing numpy/OpenCV comes back as a status the UI
 * can show instead of an exception.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const WORKER_PATH = path.join(__dirname, 'python', 'worker.py');
const DEFAULT_TIMEOUT_MS = 120000;

export function defaultPythonBin() {
  return process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
}

export function encodeBody(header, payload = null) {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(json.length, 0);
  return payload ? Buffer.concat([prefix, json, payload]) : Buffer.concat([prefix, json]);
}

export function decodeBody(body) {
  if (!Buffer.isBuffer(body) || body.length < 4) throw new Error('body too short');
  const length = body.readUInt32LE(0);
  if (4 + length > body.length) throw new Error('header length exceeds body');
  const header = JSON.parse(body.subarray(4, 4 + length).toString('utf8'));
  if (!header || typeof header !== 'object' || Array.isArray(header)) throw new Error('header must be a JSON object');
  return { header, payload: body.subarray(4 + length) };
}

export class PythonWorker {
  constructor({ pythonBin = defaultPythonBin(), workerPath = WORKER_PATH, timeoutMs = DEFAULT_TIMEOUT_MS, log = console } = {}) {
    this.pythonBin = pythonBin;
    this.workerPath = workerPath;
    this.timeoutMs = timeoutMs;
    this.log = log;
    this.child = null;
    this.chunks = [];
    this.buffered = 0;
    this.pending = new Map();
    this.nextId = 1;
    this.stderrTail = '';
    // Requests are answered strictly in order, but serialising them here keeps
    // a slow 4K frame from piling dozens of megabytes into the pipe.
    this.queue = Promise.resolve();
  }

  start() {
    if (this.child) return this.child;
    const child = spawn(this.pythonBin, ['-u', this.workerPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.chunks = [];
    this.buffered = 0;
    this.stderrTail = '';

    child.stdout.on('data', (chunk) => this.onData(chunk));
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      this.stderrTail = (this.stderrTail + text).slice(-4000);
      this.log?.warn?.(`[python] ${text.trimEnd()}`);
    });
    child.stdin.on('error', () => { /* surfaced through 'exit' */ });
    const fail = (reason) => {
      if (this.child !== child) return;
      this.child = null;
      const detail = this.stderrTail.trim().split('\n').slice(-3).join(' ');
      const error = new Error(detail ? `${reason}: ${detail}` : reason);
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(error);
      }
      this.pending.clear();
    };
    child.on('error', (error) => fail(error.code === 'ENOENT'
      ? `Không tìm thấy Python ("${this.pythonBin}"). Cài Python 3 hoặc đặt biến PYTHON_BIN`
      : `Không chạy được Python: ${error.message}`));
    child.on('exit', (code, signal) => fail(`Python worker đã thoát (${signal || `code ${code}`})`));
    return child;
  }

  // Chunks are only collected until a whole frame has arrived, then joined
  // once. Re-joining the growing buffer on every 64 KB chunk copied a 64 MB
  // 4K response ~1000 times and blocked the event loop for seconds.
  compactChunks() {
    if (this.chunks.length > 1) this.chunks = [Buffer.concat(this.chunks, this.buffered)];
  }

  onData(chunk) {
    this.chunks.push(chunk);
    this.buffered += chunk.length;
    while (this.buffered >= 4) {
      if (this.chunks[0].length < 4) this.compactChunks();
      const size = this.chunks[0].readUInt32LE(0);
      if (this.buffered < 4 + size) return;
      this.compactChunks();
      const frame = this.chunks[0];
      const body = frame.subarray(4, 4 + size);
      const rest = frame.subarray(4 + size);
      this.chunks = rest.length ? [rest] : [];
      this.buffered = rest.length;
      let message;
      try {
        message = decodeBody(body);
      } catch (error) {
        this.log?.error?.('[python] malformed frame', error);
        this.stop();
        return;
      }
      const entry = this.pending.get(message.header.id);
      if (!entry) continue;
      this.pending.delete(message.header.id);
      clearTimeout(entry.timer);
      entry.resolve(message);
    }
  }

  /**
   * Sends one request; resolves to `{ header, payload }`. Rejects on `ok: false`.
   *
   * `signal` drops a request that is still waiting for its turn (the browser
   * moved a slider again, or the tab went away), so superseded frames never
   * reach Python. A request already in Python runs to the end: the stream
   * has no way to interrupt it and its answer keeps the frames in step.
   */
  request(header, payload = null, { signal } = {}) {
    const run = () => new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(Object.assign(new Error('Request đã bị huỷ'), { name: 'AbortError', aborted: true }));
        return;
      }
      const child = this.start();
      const id = this.nextId++;
      const body = encodeBody({ ...header, id }, payload);
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32LE(body.length, 0);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Python worker không trả lời sau ${Math.round(this.timeoutMs / 1000)} s`));
        // A request that never answers leaves the stream out of step; restart.
        this.stop();
      }, this.timeoutMs);
      this.pending.set(id, {
        timer,
        reject,
        resolve: (message) => (message.header.ok === false
          ? reject(Object.assign(new Error(message.header.error || 'Python worker error'), { workerError: true }))
          : resolve(message))
      });
      child.stdin.write(prefix);
      child.stdin.write(body);
    });
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  stop() {
    const child = this.child;
    if (!child) return;
    this.child = null;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error('Python worker stopped'));
    }
    this.pending.clear();
    try { child.stdin.end(); } catch (_) { /* already gone */ }
    child.kill();
  }
}
