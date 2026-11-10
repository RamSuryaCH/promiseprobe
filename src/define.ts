import type { PromiseContract } from './types.js';

/** Declare a promise. The return value is the same object, checked by the type. */
export function definePromise<T extends PromiseContract>(contract: T): T {
  return contract;
}
