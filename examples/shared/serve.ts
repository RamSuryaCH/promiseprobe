import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface NoteBody {
  text?: string;
  idempotencyKey?: string;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buf.length;
    if (size > 1_000_000) throw new Error('body too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function serveFile(res: ServerResponse, publicDir: string): Promise<void> {
  const html = await readFile(path.join(publicDir, 'index.html'));
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(html);
}

export function listen(port: number, publicDir: string, handleApi: (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean>): void {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/health') {
        send(res, 200, { ok: true });
        return;
      }
      if (url.pathname === '/api/notes') {
        const handled = await handleApi(req, res, url);
        if (handled) return;
      }
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        await serveFile(res, publicDir);
        return;
      }
      send(res, 404, { error: 'not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'error';
      if (!res.headersSent) send(res, 500, { error: message });
      else res.end();
    }
  });
  server.listen(port, '127.0.0.1');
}

export async function readJson(req: IncomingMessage): Promise<NoteBody> {
  const raw = await readBody(req);
  if (!raw) return {};
  return JSON.parse(raw) as NoteBody;
}

export function idempotencyKey(req: IncomingMessage, body: NoteBody): string | undefined {
  const header = req.headers['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  return value || body.idempotencyKey;
}

export { send };
