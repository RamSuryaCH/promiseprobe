import { describe, expect, it } from 'vitest';
import { renderHtmlReport } from '../src/html-report.js';
import type { Report } from '../src/types.js';
import { renderWitness } from '../src/witness.js';

function report(name: string): Report {
  return {
    version: 1,
    toolVersion: '1.0.0',
    name,
    guarantee: 'remote',
    appUrl: 'http://127.0.0.1:4173',
    startedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 4200,
    scenarios: [
      {
        scenario: 'request-dropped',
        title: 'Request dropped',
        description: 'The write never arrives.',
        timing: 'on request',
        verdict: 'broken-promise',
        flags: ['premature'],
        rationale: 'The success indicator was shown, but the remote check found 0 effect(s), not 1.',
        indicatorShown: true,
        indicatorAtMs: 12,
        responseReceivedAtMs: null,
        durableAtMs: null,
        persistence: { count: 0, detail: '0 matching note(s) in the store' },
        timeline: [
          { t: 0, kind: 'action', detail: 'user action' },
          { t: 12, kind: 'indicator', detail: 'success indicator visible' },
        ],
        durationMs: 900,
        tracePath: '/tmp/promiseprobe/traces/request-dropped.zip',
      },
    ],
    witnesses: [],
    seededDefects: [],
    summary: {
      total: 1,
      honoured: 0,
      brokenPromise: 1,
      duplicateSideEffect: 0,
      prematureIndicator: 0,
      errors: 0,
    },
  };
}

describe('report', () => {
  it('escapes the promise name and shows the verdict', () => {
    const html = renderHtmlReport(report('<script>alert(1)</script>'));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('broken-promise');
    expect(html).toContain('traces/request-dropped.zip');
    expect(html).toContain('Also premature');
  });

  it('writes a runnable witness with a relative probe import', () => {
    const source = renderWitness({
      witnessFile: '/tmp/out/witness.spec.ts',
      probeFile: '/tmp/examples/broken-notes/probe.ts',
      libraryEntry: '/tmp/src/index.ts',
      promiseName: 'Save a note',
      cases: [{ scenario: 'request-dropped', verdict: 'broken-promise' }],
    });
    expect(source).toContain('../examples/broken-notes/probe.ts');
    expect(source).toContain('../src/index.ts');
    expect(source).toContain("scenario: 'request-dropped'");
    expect(source).toContain("verdict: 'broken-promise'");
    expect(source).toContain('assert.equal(result.verdict, item.verdict)');
    expect(source).toContain('npx tsx out/witness.spec.ts');
  });
});
