import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { listen, readJson, send, type NoteBody } from '../shared/serve.js';

/**
 * Broken store: every POST inserts a new note.
 * Idempotency-Key is accepted and ignored. That is the duplicate-write defect.
 */

interface Note {
  id: string;
  text: string;
  createdAt: string;
}

const notes: Note[] = [];
const port = Number(process.env.PORT ?? 4173);
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

function create(body: NoteBody): { status: number; json: unknown } {
  const text = body.text?.trim() ?? '';
  if (!text) return { status: 400, json: { error: 'text is required' } };
  const note: Note = { id: randomUUID(), text, createdAt: new Date().toISOString() };
  notes.push(note);
  return { status: 201, json: { note } };
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
    const result = create(body);
    send(res, result.status, result.json);
    return true;
  }
  return false;
});
