import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { idempotencyKey, listen, readJson, send, type NoteBody } from '../shared/serve.js';

/**
 * Fixed store: one note per idempotency key.
 * A second POST with the same key and the same text replays the first write.
 * The same key with a different text is a conflict. This is the in-memory
 * form of the conditional put in examples/aws-backend.
 */

interface Note {
  id: string;
  text: string;
  createdAt: string;
  idempotencyKey: string;
}

const notes: Note[] = [];
const byKey = new Map<string, Note>();
const port = Number(process.env.PORT ?? 4174);
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

function create(body: NoteBody, key: string | undefined): { status: number; json: unknown } {
  const text = body.text?.trim() ?? '';
  if (!text) return { status: 400, json: { error: 'text is required' } };
  if (!key) return { status: 400, json: { error: 'Idempotency-Key is required' } };
  const existing = byKey.get(key);
  if (existing) {
    if (existing.text !== text) {
      return { status: 409, json: { error: 'idempotency key reused with a different note' } };
    }
    return { status: 200, json: { note: existing, deduped: true } };
  }
  const note: Note = {
    id: randomUUID(),
    text,
    createdAt: new Date().toISOString(),
    idempotencyKey: key,
  };
  byKey.set(key, note);
  notes.push(note);
  return { status: 201, json: { note, deduped: false } };
}

listen(port, publicDir, async (req, res, url) => {
  if (req.method === 'GET') {
    const text = url.searchParams.get('text');
    const matched = text == null ? notes : notes.filter((note) => note.text === text);
    send(res, 200, { notes: matched });
    return true;
  }
  if (req.method === 'POST') {
    const body = await readJson(req);
    const result = create(body, idempotencyKey(req, body));
    send(res, result.status, result.json);
    return true;
  }
  return false;
});
