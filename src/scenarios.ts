import type { ScenarioId } from './types.js';

export interface ScenarioMeta {
  id: ScenarioId;
  title: string;
  timing: string;
  description: string;
}

export const SCENARIO_ORDER: readonly ScenarioId[] = [
  'response-delay',
  'request-dropped',
  'response-dropped',
  'restart-after-success',
  'double-submit',
  'offline',
];

export const SCENARIO_CATALOG: Record<ScenarioId, ScenarioMeta> = {
  'response-delay': {
    id: 'response-delay',
    title: 'Response delay',
    timing: 'on request',
    description:
      'The write is held before the response is released, so an indicator that does not wait for the acknowledgement shows up early.',
  },
  'request-dropped': {
    id: 'request-dropped',
    title: 'Request dropped',
    timing: 'on request',
    description: 'The write is aborted in the browser and never reaches the server.',
  },
  'response-dropped': {
    id: 'response-dropped',
    title: 'Lost acknowledgement',
    timing: 'after commit, before the ack',
    description:
      'The server commits the write, then the response is dropped. The client sees a timeout after the commit.',
  },
  'restart-after-success': {
    id: 'restart-after-success',
    title: 'Restart after success',
    timing: 'immediately after the indicator',
    description:
      'The moment the success indicator appears, a local promise reloads the page and a remote promise throws the browser context away.',
  },
  'double-submit': {
    id: 'double-submit',
    title: 'Double submit',
    timing: 'second gesture just after the first',
    description: 'The action is delivered twice, the way a double click or an eager retry does.',
  },
  offline: {
    id: 'offline',
    title: 'Offline',
    timing: 'before the action',
    description: 'The browser goes offline after the page has loaded and stays offline through the action.',
  },
};
