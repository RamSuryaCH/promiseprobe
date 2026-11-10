import { VERDICT_LABEL, type Report, type ScenarioResult, type TimelineEvent, type Verdict } from './types.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatMs(ms: number): string {
  if (ms >= 1000) {
    const seconds = ms / 1000;
    return `${seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1)}s`;
  }
  return `${Math.round(ms)}ms`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const DOT: Record<TimelineEvent['kind'], string> = {
  navigate: '#8a8478',
  action: '#1c1915',
  request: '#1c1915',
  response: '#1b6b43',
  indicator: '#9d1c2e',
  fault: '#8a4b08',
  durable: '#1b6b43',
  check: '#35327a',
  offline: '#8a4b08',
  restart: '#8a4b08',
};

function timeline(events: TimelineEvent[]): string {
  if (events.length === 0) return '';
  const max = Math.max(...events.map((event) => event.t), 1);
  const dots = events
    .map((event) => {
      const left = (event.t / max) * 100;
      return `<i class="dot" style="left:${left.toFixed(2)}%;background:${DOT[event.kind]}" title="${escapeHtml(`${formatMs(event.t)} ${event.detail}`)}"></i>`;
    })
    .join('');
  const rows = events
    .map(
      (event) =>
        `<li><time>${escapeHtml(formatMs(event.t))}</time><span>${escapeHtml(event.detail)}</span></li>`,
    )
    .join('');
  return `<div class="track" aria-hidden="true">${dots}</div><ol class="events">${rows}</ol>`;
}

function pill(verdict: Verdict | null): string {
  if (!verdict) return `<span class="pill error">error</span>`;
  return `<span class="pill ${verdict}">${escapeHtml(VERDICT_LABEL[verdict])}</span>`;
}

function scenarioCard(result: ScenarioResult): string {
  const delay =
    result.scenario === 'response-delay' && result.delayMs != null
      ? ` · delay ${escapeHtml(formatMs(result.delayMs))}`
      : '';
  const persistence = result.persistence
    ? `<p class="detail">${escapeHtml(result.persistence.detail ?? `${result.persistence.count} persisted`)}</p>`
    : '';
  const extra = result.flags.includes('premature') && result.verdict !== 'premature-indicator'
    ? `<p class="also">Also premature: the indicator led the durable write.</p>`
    : '';
  const error = result.error ? `<p class="detail">${escapeHtml(result.error)}</p>` : '';
  const trace = result.tracePath
    ? `<p class="trace"><a href="${escapeHtml(pathToHref(result.tracePath))}">Playwright trace</a></p>`
    : '';
  return `<article>
    <header>
      <div>
        <h3>${escapeHtml(result.title)}</h3>
        <p class="when">${escapeHtml(result.timing)}${delay}</p>
      </div>
      ${pill(result.verdict)}
    </header>
    <p>${escapeHtml(result.description)}</p>
    <p class="rationale">${escapeHtml(result.rationale)}</p>
    ${extra}
    ${persistence}
    ${error}
    ${timeline(result.timeline)}
    ${trace}
  </article>`;
}

function pathToHref(file: string): string {
  const normalized = file.split('\\').join('/');
  const marker = '/traces/';
  const index = normalized.lastIndexOf(marker);
  if (index >= 0) return normalized.slice(index + 1);
  return normalized;
}

function witnessBlock(report: Report): string {
  if (report.witnesses.length === 0) {
    return `<section class="witness quiet"><h2>Witness</h2><p>No failing scenario. Nothing to reduce.</p></section>`;
  }
  const items = report.witnesses
    .map((witness) => {
      const delay = witness.delayMs != null ? ` · delay ${formatMs(witness.delayMs)}` : '';
      const trace = witness.tracePath
        ? ` · <a href="${escapeHtml(pathToHref(witness.tracePath))}">trace</a>`
        : '';
      const shrink =
        witness.shrinkSteps.length > 0
          ? `<p class="detail">Delay search: ${escapeHtml(
              witness.shrinkSteps
                .map((step) => `${step.delayMs}ms ${step.verdict ?? 'error'}`)
                .join(' → '),
            )}</p>`
          : '';
      return `<li>
        <strong>${escapeHtml(witness.title)}</strong>
        <span>${escapeHtml(witness.timing)}${escapeHtml(delay)} · reproduced ${witness.reproducedRuns}/${witness.attempts}${trace}</span>
        <em>${escapeHtml(witness.rationale)}</em>
        ${witness.note ? `<p class="detail">${escapeHtml(witness.note)}</p>` : ''}
        ${shrink}
      </li>`;
    })
    .join('');
  const source = report.witnessSource
    ? `<details>
        <summary>Generated regression test <span class="detail">witness.spec.ts</span></summary>
        <pre><code>${escapeHtml(report.witnessSource)}</code></pre>
      </details>`
    : '';
  return `<section class="witness">
    <h2>Minimal witness</h2>
    <p>Each failure was replayed, and added delay was shrunk to the smallest value that still failed.</p>
    <ul>${items}</ul>
    ${source}
  </section>`;
}

function seededBlock(report: Report): string {
  if (report.seededDefects.length === 0) return '';
  const caught = report.seededDefects.filter((defect) => defect.detected).length;
  const rows = report.seededDefects
    .map((defect) => {
      const mark = defect.detected ? 'caught' : 'missed';
      return `<li><span class="mark ${mark}">${mark}</span><span><strong>${escapeHtml(defect.id)}</strong> ${escapeHtml(defect.summary)}</span></li>`;
    })
    .join('');
  return `<section class="seeded"><h2>Seeded defects <span>${caught}/${report.seededDefects.length}</span></h2><ul>${rows}</ul></section>`;
}

export function renderHtmlReport(report: Report): string {
  const headline =
    report.summary.errors > 0
      ? 'The sweep hit a harness error.'
      : report.summary.honoured === report.summary.total
        ? 'Every interruption matched the guarantee.'
        : 'The app claimed more than it kept.';
  const started = escapeHtml(report.startedAt.replace('T', ' ').replace('Z', ' UTC'));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PromiseProbe · ${escapeHtml(report.name)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,640&family=Outfit:wght@400;520;640&display=swap" rel="stylesheet">
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f3f0e8; color: #1c1915; font: 16px/1.5 Outfit, "Avenir Next", "Segoe UI", sans-serif; }
    main { width: min(880px, calc(100% - 40px)); margin: 0 auto; padding: 48px 0 72px; }
    .brand { margin: 0; letter-spacing: 0.16em; text-transform: uppercase; font-size: 12px; font-weight: 640; color: #6f6a62; }
    h1 { font-family: Fraunces, "Iowan Old Style", Palatino, Georgia, serif; font-weight: 560; font-size: 48px; line-height: 1.05; margin: 10px 0 8px; letter-spacing: -0.03em; }
    .sub { margin: 0; color: #5e584f; }
    .lede { font-size: 20px; margin: 22px 0 8px; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 22px 0 8px; padding: 0; list-style: none; }
    .stats li { background: #fffcf7; border: 1px solid #e4ddd2; border-radius: 12px; padding: 12px 14px; }
    .stats b { display: block; font-family: Fraunces, Georgia, serif; font-size: 28px; font-weight: 560; line-height: 1; }
    .stats span { color: #6f6a62; font-size: 13px; }
    h2 { font-family: Fraunces, Georgia, serif; font-weight: 560; font-size: 28px; margin: 34px 0 8px; }
    h2 span { color: #6f6a62; font-family: Outfit, sans-serif; font-size: 16px; margin-left: 8px; }
    .witness, .seeded { background: #fffcf7; border: 1px solid #e4ddd2; border-radius: 16px; padding: 8px 20px 16px; }
    .witness.quiet { color: #5e584f; }
    .witness ul, .seeded ul { list-style: none; padding: 0; margin: 0; }
    .witness li, .seeded li { padding: 12px 0; border-top: 1px solid #eee8de; display: grid; gap: 2px; }
    .witness li span, .seeded li span { color: #3f3b36; }
    .witness li em { font-style: normal; color: #5e584f; }
    .mark { font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 640; }
    .mark.caught { color: #145c38; }
    .mark.missed { color: #8d1526; }
    .seeded li { grid-template-columns: 72px 1fr; gap: 12px; align-items: baseline; }
    article { background: #fffcf7; border: 1px solid #e4ddd2; border-radius: 16px; padding: 16px 18px 14px; margin: 12px 0; }
    article header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    h3 { margin: 0; font-size: 18px; }
    .when, .detail, .trace { color: #6f6a62; font-size: 13px; margin: 2px 0; }
    .also { color: #35327a; margin: 8px 0; }
    .rationale { margin: 8px 0; }
    .pill { display: inline-block; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 640; padding: 5px 8px; border-radius: 999px; white-space: nowrap; }
    .pill.honoured { color: #145c38; background: #e3f3ea; }
    .pill.broken-promise { color: #8d1526; background: #fde8eb; }
    .pill.duplicate-side-effect { color: #7a4510; background: #f8ecd9; }
    .pill.premature-indicator { color: #2e2b72; background: #ecebff; }
    .pill.error { color: #6f6a62; background: #eeeae3; }
    .track { position: relative; height: 28px; margin: 12px 0 4px; background: linear-gradient(#d9d3c7, #d9d3c7) center / 100% 1px no-repeat; }
    .dot { position: absolute; top: 9px; width: 10px; height: 10px; border-radius: 50%; transform: translateX(-50%); box-shadow: 0 0 0 3px #fffcf7; }
    .events { list-style: none; padding: 0; margin: 0; }
    .events li { display: flex; gap: 14px; font-size: 13px; padding: 2px 0; color: #3f3b36; }
    .events time { width: 56px; flex: none; color: #6f6a62; font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; }
    details { margin-top: 8px; }
    summary { cursor: pointer; color: #3f3b36; }
    summary .detail { margin-left: 8px; }
    pre { margin: 14px 0 0; padding: 14px; background: #1c1915; color: #f3f0e8; border-radius: 12px; overflow: auto; max-height: 280px; font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace; }
    footer { margin-top: 28px; color: #6f6a62; font-size: 13px; }
    a { color: inherit; }
    @media (max-width: 720px) {
      h1 { font-size: 36px; }
      .stats { grid-template-columns: 1fr 1fr; }
      .seeded li { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <p class="brand">PromiseProbe</p>
    <h1>${escapeHtml(report.name)}</h1>
    <p class="sub">${escapeHtml(report.guarantee)} guarantee · ${escapeHtml(report.appUrl)} · ${started} · ${escapeHtml(formatDuration(report.durationMs))}</p>
    <p class="lede">${escapeHtml(headline)}</p>
    <ul class="stats">
      <li><b>${report.summary.honoured}</b><span>honoured</span></li>
      <li><b>${report.summary.brokenPromise}</b><span>broken promise</span></li>
      <li><b>${report.summary.duplicateSideEffect}</b><span>duplicate side effect</span></li>
      <li><b>${report.summary.prematureIndicator}</b><span>premature indicator</span></li>
    </ul>
    ${witnessBlock(report)}
    ${seededBlock(report)}
    <h2>Scenarios</h2>
    ${report.scenarios.map(scenarioCard).join('\n')}
    <footer>PromiseProbe v${escapeHtml(report.toolVersion)} · Browser and app interruptions only. This is not a power-loss test.</footer>
  </main>
</body>
</html>
`;
}
