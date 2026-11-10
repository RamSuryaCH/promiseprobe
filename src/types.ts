import type { APIRequestContext, Page } from 'playwright';

export const VERSION = '1.0.0';

export type Guarantee = 'local' | 'remote';

export type ScenarioId =
  | 'response-delay'
  | 'request-dropped'
  | 'response-dropped'
  | 'restart-after-success'
  | 'double-submit'
  | 'offline';

export type Verdict =
  | 'honoured'
  | 'broken-promise'
  | 'duplicate-side-effect'
  | 'premature-indicator';

export const VERDICT_LABEL: Record<Verdict, string> = {
  honoured: 'honoured',
  'broken-promise': 'broken promise',
  'duplicate-side-effect': 'duplicate side effect',
  'premature-indicator': 'premature indicator',
};

export interface PersistenceResult {
  /** How many persisted effects belong to this one user action. */
  count: number;
  /** Set false when the effect exists but is not actually recoverable. */
  ok?: boolean;
  detail?: string;
}

export interface RunContext {
  page: Page;
  request: APIRequestContext;
  runId: string;
  /** Full app URL, including any query string. */
  appUrl: string;
  /** Values the action records for the persistence check. The runner sets `text`. */
  bag: Record<string, string>;
}

export interface SeededDefect {
  id: string;
  scenario: ScenarioId;
  verdict: Verdict;
  summary: string;
}

export interface AppStart {
  /** TypeScript or JavaScript entry, spawned with `node --import tsx`. */
  file: string;
  env?: Record<string, string>;
  readyTimeoutMs?: number;
}

export interface PromiseContract {
  name: string;
  guarantee: Guarantee;
  app: {
    url: string;
    start?: AppStart;
  };
  /** Pathname of the write request. Default `/api/notes`. */
  writePath?: string;
  prepare?: (ctx: RunContext) => Promise<void>;
  action: (ctx: RunContext) => Promise<void>;
  successIndicator: (ctx: RunContext) => Promise<boolean>;
  persistenceCheck: (ctx: RunContext) => Promise<PersistenceResult>;
  /**
   * Local guarantees only. Polled until true so a success indicator that
   * appears before the durable local write can be called premature.
   */
  durabilitySignal?: (ctx: RunContext) => Promise<boolean>;
  /** Upper bound on how long a write may still be in flight. Default 8000. */
  settleMs?: number;
  /** Quiet period after the last write attempt before the persistence check. Default 800. */
  quietMs?: number;
  /** How long a restart scenario waits for the indicator. Default 4000. */
  indicatorWaitMs?: number;
  /** Added latency for the response-delay scenario. Default 500. */
  responseDelayMs?: number;
  /** Subset of the sweep. Default: every scenario. */
  scenarios?: ScenarioId[];
  /** Effects one honest action should leave behind. Default 1. */
  expectedCount?: number;
  /** Defects you planted, so a report can say which ones the sweep caught. */
  seededDefects?: SeededDefect[];
}

export interface TimelineEvent {
  t: number;
  kind:
    | 'navigate'
    | 'action'
    | 'request'
    | 'response'
    | 'indicator'
    | 'fault'
    | 'durable'
    | 'check'
    | 'offline'
    | 'restart';
  detail: string;
}

export interface ScenarioResult {
  scenario: ScenarioId;
  title: string;
  description: string;
  timing: string;
  delayMs?: number;
  verdict: Verdict | null;
  flags: Array<'premature'>;
  rationale: string;
  indicatorShown: boolean;
  indicatorAtMs: number | null;
  responseReceivedAtMs: number | null;
  durableAtMs: number | null;
  persistence: PersistenceResult | null;
  timeline: TimelineEvent[];
  durationMs: number;
  error?: string;
  tracePath?: string;
}

export interface ShrinkStep {
  delayMs: number;
  verdict: Verdict | null;
}

export interface Witness {
  scenario: ScenarioId;
  title: string;
  timing: string;
  delayMs?: number;
  verdict: Verdict;
  rationale: string;
  reproducedRuns: number;
  attempts: number;
  tracePath?: string;
  shrinkSteps: ShrinkStep[];
  note?: string;
}

export interface Report {
  version: 1;
  toolVersion: string;
  name: string;
  guarantee: Guarantee;
  appUrl: string;
  startedAt: string;
  durationMs: number;
  scenarios: ScenarioResult[];
  witnesses: Witness[];
  witnessSource?: string;
  seededDefects: Array<SeededDefect & { detected: boolean }>;
  summary: {
    total: number;
    honoured: number;
    brokenPromise: number;
    duplicateSideEffect: number;
    prematureIndicator: number;
    errors: number;
  };
  output?: {
    directory: string;
    html: string;
    json: string;
    witness?: string;
  };
}

export interface Observation {
  guarantee: Guarantee;
  scenario: ScenarioId;
  indicatorShown: boolean;
  indicatorAtMs: number | null;
  responseReceivedAtMs: number | null;
  durableAtMs: number | null;
  /** True when a local durability signal was being polled. */
  watchingDurability: boolean;
  persistence: PersistenceResult;
  expectedCount: number;
}

export interface Judgment {
  verdict: Verdict;
  flags: Array<'premature'>;
  rationale: string;
}
