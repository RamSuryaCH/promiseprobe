import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PromiseContract } from './types.js';

export async function loadProbe(file: string): Promise<{ contract: PromiseContract; file: string }> {
  const abs = path.resolve(file);
  const mod = (await import(pathToFileURL(abs).href)) as {
    default?: PromiseContract;
    probe?: PromiseContract;
  };
  const contract = mod.default ?? mod.probe;
  if (!contract || typeof contract.name !== 'string' || typeof contract.action !== 'function') {
    throw new Error(`${file} must default-export definePromise(...).`);
  }
  return { contract, file: abs };
}
