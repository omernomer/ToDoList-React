import React, { useEffect, useMemo, useState } from 'react';
import { hot } from 'react-hot-loader';
import {
    createScanJob,
    exportGitHubIssues,
    fetchScanJob,
    getReportDownloadUrl,
} from './audit/api';

const initialForm = {
    rootUrl: 'https://example.com',
    pageLimit: 10,
    depthLimit: 1,
};

const severityOrder = ['critical', 'serious', 'moderate', 'minor'];
const wcagPrinciples = {
    1: 'Perceivable',
    2: 'Operable',
    3: 'Understandable',
    4: 'Robust',
};

const styles = `
:root {
  color-scheme: dark;
  font-family: Inter, Arial, Helvetica, sans-serif;
  background: #020617;
  color: #e2e8f0;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: radial-gradient(circle at top, rgba(56, 189, 248, 0.2), transparent 35%), linear-gradient(180deg, #020617 0%, #0f172a 100%);
  min-height: 100vh;
}
a { color: inherit; }
.app-shell { width: min(1200px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0 48px; }
.hero-card,.panel,.metric-card,.finding-card,.page-card { background: rgba(15,23,42,.88); border: 1px solid rgba(148,163,184,.18); border-radius: 20px; box-shadow: 0 24px 60px rgba(15,23,42,.32); }
.hero-card { display:grid; grid-template-columns:1.6fr 1fr; gap:24px; padding:32px; margin-bottom:24px; }
.eyebrow { text-transform: uppercase; letter-spacing:.12em; color:#38bdf8; font-size:.8rem; margin-bottom:12px; }
h1,h2,h3,p { margin-top:0; }
h1 { font-size: clamp(2rem, 4vw, 3.4rem); margin-bottom:12px; }
.hero-copy,.disclaimer-panel p,.panel p,label,li,span,dd,dt,a,button,input,summary,code,pre { color:#cbd5e1; }
.disclaimer-panel { padding:24px; border-radius:16px; background: rgba(15,118,110,.16); }
.panel { padding:24px; margin-bottom:24px; }
.scan-form,.github-form { display:grid; grid-template-columns:2fr repeat(2,minmax(120px,180px)) auto; gap:16px; align-items:end; }
.github-form { grid-template-columns: repeat(3,minmax(0,1fr)); }
label { display:flex; flex-direction:column; gap:8px; font-weight:600; }
input { width:100%; background: rgba(15,23,42,.8); border: 1px solid rgba(148,163,184,.25); border-radius:12px; padding:12px 14px; }
button,.download-group a,.finding-footer a { border:none; border-radius:12px; background:linear-gradient(135deg,#06b6d4,#3b82f6); color:white; padding:12px 16px; font-weight:700; text-decoration:none; cursor:pointer; text-align:center; }
button:disabled { opacity:.65; cursor:progress; }
.status-strip,.metrics-grid,.summary-columns,.finding-heading,.finding-footer,.panel-header,.severity-list,.page-grid,.report-grid { display:grid; gap:16px; }
.status-strip { grid-template-columns: repeat(auto-fit, minmax(140px,max-content)); align-items:center; margin-top:18px; }
.status-pill { display:inline-flex; width:fit-content; align-items:center; gap:8px; border-radius:999px; padding:6px 12px; text-transform:capitalize; font-weight:700; background: rgba(148,163,184,.18); }
.status-completed,.severity-minor { background: rgba(34,197,94,.22); }
.status-running,.status-queued,.severity-moderate { background: rgba(250,204,21,.2); }
.status-failed,.severity-critical { background: rgba(239,68,68,.24); }
.status-serious { background: rgba(249,115,22,.24); }
.metrics-grid { grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); margin-bottom:24px; }
.metric-card { padding:24px; }
.metric-card strong { display:block; font-size:2.5rem; color:white; margin:8px 0; }
.summary-columns,.report-grid { grid-template-columns: repeat(auto-fit,minmax(260px,1fr)); }
.severity-list { grid-template-columns: repeat(2,minmax(0,1fr)); }
.severity-chip,.trend-card { display:flex; justify-content:space-between; gap:12px; padding:14px 16px; border-radius:14px; }
.principle-list,.manual-review-list,.export-list,.mini-severity-list { list-style:none; padding:0; margin:0; }
.principle-list li,.mini-severity-list li { display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid rgba(148,163,184,.15); }
.download-group { display:flex; flex-wrap:wrap; gap:10px; }
.finding-list { display:grid; grid-template-columns: repeat(auto-fit,minmax(300px,1fr)); gap:18px; }
.finding-card { padding:20px; }
.priority-score { color:#38bdf8; font-weight:700; }
.finding-meta { display:grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap:12px; }
.finding-meta dt { font-size:.82rem; text-transform:uppercase; letter-spacing:.08em; color:#94a3b8; }
.finding-footer { grid-template-columns: 1fr auto; align-items:center; }
.page-grid { grid-template-columns: repeat(auto-fit,minmax(260px,1fr)); }
.page-card { overflow:hidden; }
.page-card img { width:100%; aspect-ratio:16/9; object-fit:cover; display:block; }
.page-card-body { padding:18px; }
.page-url { word-break: break-word; color:#94a3b8; }
.logs { overflow-x:auto; background: rgba(2,6,23,.6); padding:16px; border-radius:16px; }
.error-banner,.github-message { margin-top:16px; color:#fca5a5; }
@media (max-width: 900px) {
  .hero-card,.scan-form,.github-form,.finding-meta,.finding-footer { grid-template-columns:1fr; }
  .panel-header { display:flex; flex-direction:column; }
}
`;

const App = () => {
    const [form, setForm] = useState(initialForm);
    const [job, setJob] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [githubForm, setGithubForm] = useState({ repoOwner: '', repoName: '', token: '' });
    const [githubState, setGithubState] = useState({ isSubmitting: false, message: '', exports: [] });

    useEffect(() => {
        if (!job || !['queued', 'running'].includes(job.status)) {
            return undefined;
        }
        const intervalId = window.setInterval(async () => {
            try {
                const refreshedJob = await fetchScanJob(job.id);
                setJob(refreshedJob);
            } catch (refreshError) {
                setError(refreshError.message);
            }
        }, 2000);
        return () => window.clearInterval(intervalId);
    }, [job]);

    const principleRows = useMemo(() => {
        if (!job?.summary?.principle_counts) {
            return [];
        }
        return Object.entries(job.summary.principle_counts).map(([principleId, count]) => ({
            principleId,
            label: wcagPrinciples[principleId] || 'Other',
            count,
        }));
    }, [job]);

    const startScan = async (event) => {
        event.preventDefault();
        setSubmitting(true);
        setError('');
        setGithubState({ isSubmitting: false, message: '', exports: [] });
        try {
            const createdJob = await createScanJob(form);
            setJob(createdJob);
        } catch (submitError) {
            setError(submitError.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleGitHubExport = async (event) => {
        event.preventDefault();
        if (!job) {
            return;
        }
        setGithubState({ isSubmitting: true, message: '', exports: [] });
        try {
            const response = await exportGitHubIssues(job.id, githubForm);
            setGithubState({
                isSubmitting: false,
                message: `Created ${response.exports.length} GitHub issue(s).`,
                exports: response.exports,
            });
        } catch (exportError) {
            setGithubState({ isSubmitting: false, message: exportError.message, exports: [] });
        }
    };

    return (
        <>
            <style>{styles}</style>
            <div className="app-shell">
                <section className="hero-card">
                    <div>
                        <p className="eyebrow">Accessibility audit automation tool</p>
                        <h1>Automated accessibility baseline scanner</h1>
                        <p className="hero-copy">
                            Submit a public URL to crawl a limited set of pages, prioritize recurring accessibility issues,
                            map results to WCAG 2.2, and export developer-ready reports.
                        </p>
                    </div>
                    <div className="disclaimer-panel">
                        <h2>Important positioning</h2>
                        <p>Automated audit only. This app is designed for technical baselining, not legal certification or a substitute for manual review.</p>
                        <ul>
                            <li>Public pages only for this MVP.</li>
                            <li>De-duplicates recurring defects across crawled pages.</li>
                            <li>Exports JSON, CSV, PDF, and optional GitHub issues.</li>
                        </ul>
                    </div>
                </section>

                <section className="panel">
                    <h2>Start a scan</h2>
                    <form className="scan-form" onSubmit={startScan}>
                        <label>
                            Root URL
                            <input
                                type="url"
                                value={form.rootUrl}
                                onChange={(event) => setForm({ ...form, rootUrl: event.target.value })}
                                placeholder="https://example.com"
                                required
                            />
                        </label>
                        <label>
                            Page limit
                            <input
                                type="number"
                                min="1"
                                max="25"
                                value={form.pageLimit}
                                onChange={(event) => setForm({ ...form, pageLimit: Number(event.target.value) })}
                            />
                        </label>
                        <label>
                            Depth limit
                            <input
                                type="number"
                                min="0"
                                max="3"
                                value={form.depthLimit}
                                onChange={(event) => setForm({ ...form, depthLimit: Number(event.target.value) })}
                            />
                        </label>
                        <button type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Run baseline scan'}</button>
                    </form>
                    {error ? <p className="error-banner">{error}</p> : null}
                    {job ? (
                        <div className="status-strip">
                            <span className={`status-pill status-${job.status}`}>{job.status}</span>
                            <span>Scan job ID: {job.id}</span>
                            <span>Pages requested: {job.page_limit}</span>
                            <span>Depth limit: {job.depth_limit}</span>
                        </div>
                    ) : null}
                </section>

                {job?.summary ? (
                    <>
                        <section className="metrics-grid">
                            <MetricCard label="Overall score" value={job.summary.overall_score} helper="Weighted automated baseline score" />
                            <MetricCard label="Grouped findings" value={job.summary.total_findings} helper="Deduplicated issue groups" />
                            <MetricCard label="Critical + serious" value={job.summary.severity_counts.critical + job.summary.severity_counts.serious} helper="Highest-priority defects" />
                            <MetricCard label="Pages scanned" value={job.scanned_pages.length} helper="Public pages crawled in this run" />
                        </section>

                        <section className="panel executive-summary">
                            <div className="panel-header">
                                <div>
                                    <h2>Executive summary</h2>
                                    <p>{job.summary.disclaimer}</p>
                                </div>
                                <div className="download-group">
                                    <a href={getReportDownloadUrl(job.id, 'json')} target="_blank" rel="noreferrer">Download JSON</a>
                                    <a href={getReportDownloadUrl(job.id, 'csv')} target="_blank" rel="noreferrer">Download CSV</a>
                                    <a href={getReportDownloadUrl(job.id, 'pdf')} target="_blank" rel="noreferrer">Download PDF</a>
                                </div>
                            </div>

                            <div className="summary-columns">
                                <div>
                                    <h3>Severity counts</h3>
                                    <div className="severity-list">
                                        {severityOrder.map((severity) => (
                                            <div className={`severity-chip severity-${severity}`} key={severity}>
                                                <strong>{severity}</strong>
                                                <span>{job.summary.severity_counts[severity]}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <h3>WCAG principle coverage</h3>
                                    <ul className="principle-list">
                                        {principleRows.map((row) => (
                                            <li key={row.principleId}>
                                                <span>{row.label}</span>
                                                <strong>{row.count}</strong>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                                <div>
                                    <h3>Trend vs previous scan</h3>
                                    {job.summary.trend ? (
                                        <div className="trend-card">
                                            <p><strong>Previous score:</strong> {job.summary.trend.previous_score}</p>
                                            <p><strong>Score delta:</strong> {job.summary.trend.score_delta}</p>
                                            <p><strong>Finding delta:</strong> {job.summary.trend.findings_delta}</p>
                                        </div>
                                    ) : <p>No previous scan for this root URL yet.</p>}
                                </div>
                            </div>
                        </section>

                        <section className="panel">
                            <h2>Top issue groups</h2>
                            <div className="finding-list">
                                {job.grouped_findings.slice(0, 8).map((finding) => (
                                    <article className="finding-card" key={finding.id}>
                                        <div className="finding-heading">
                                            <span className={`status-pill status-${finding.impact}`}>{finding.impact}</span>
                                            <span className="priority-score">Priority {finding.priority_score}</span>
                                        </div>
                                        <h3>{finding.rule_name}</h3>
                                        <p>{finding.why_it_matters}</p>
                                        <dl className="finding-meta">
                                            <div>
                                                <dt>WCAG</dt>
                                                <dd>{finding.wcag_refs.join(', ')}</dd>
                                            </div>
                                            <div>
                                                <dt>Pages affected</dt>
                                                <dd>{finding.page_count}</dd>
                                            </div>
                                            <div>
                                                <dt>Selector</dt>
                                                <dd><code>{finding.selector}</code></dd>
                                            </div>
                                        </dl>
                                        <div className="finding-footer">
                                            <div>
                                                <strong>Suggested fix</strong>
                                                <p>{finding.suggested_fix}</p>
                                            </div>
                                            <a href={`http://localhost:8080${finding.screenshot_path}`} target="_blank" rel="noreferrer">View evidence</a>
                                        </div>
                                        <details>
                                            <summary>Developer guidance</summary>
                                            <p><strong>Help:</strong> {finding.help}</p>
                                            <p><strong>Example:</strong> <code>{finding.code_example}</code></p>
                                            <p><strong>Help URL:</strong> <a href={finding.help_url} target="_blank" rel="noreferrer">{finding.help_url}</a></p>
                                            <ul>
                                                {finding.page_urls.map((pageUrl) => <li key={pageUrl}>{pageUrl}</li>)}
                                            </ul>
                                        </details>
                                    </article>
                                ))}
                            </div>
                        </section>

                        <section className="panel">
                            <h2>Page-level report</h2>
                            <div className="page-grid">
                                {job.summary.page_breakdown.map((page) => (
                                    <article className="page-card" key={page.id}>
                                        <img src={`http://localhost:8080${page.screenshot_path}`} alt={`Evidence snapshot for ${page.title}`} />
                                        <div className="page-card-body">
                                            <h3>{page.title}</h3>
                                            <p className="page-url">{page.url}</p>
                                            <p><strong>Automated score:</strong> {page.lighthouse_score ?? 'n/a'}</p>
                                            <p><strong>Issue groups:</strong> {page.issue_count}</p>
                                            <ul className="mini-severity-list">
                                                {severityOrder.map((severity) => (
                                                    <li key={severity}><span>{severity}</span><strong>{page.severity_counts[severity]}</strong></li>
                                                ))}
                                            </ul>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        </section>

                        <section className="panel report-grid">
                            <div>
                                <h2>Manual review required</h2>
                                <ul className="manual-review-list">
                                    {job.manual_review_items.map((item) => <li key={item}>{item}</li>)}
                                </ul>
                            </div>
                            <div>
                                <h2>Export to GitHub</h2>
                                <form className="github-form" onSubmit={handleGitHubExport}>
                                    <label>
                                        Repo owner
                                        <input value={githubForm.repoOwner} onChange={(event) => setGithubForm({ ...githubForm, repoOwner: event.target.value })} placeholder="octocat" />
                                    </label>
                                    <label>
                                        Repo name
                                        <input value={githubForm.repoName} onChange={(event) => setGithubForm({ ...githubForm, repoName: event.target.value })} placeholder="hello-world" />
                                    </label>
                                    <label>
                                        GitHub token
                                        <input type="password" value={githubForm.token} onChange={(event) => setGithubForm({ ...githubForm, token: event.target.value })} placeholder="ghp_..." />
                                    </label>
                                    <button type="submit" disabled={githubState.isSubmitting}>{githubState.isSubmitting ? 'Exporting…' : 'Create GitHub issues'}</button>
                                </form>
                                {githubState.message ? <p className="github-message">{githubState.message}</p> : null}
                                {githubState.exports.length ? (
                                    <ul className="export-list">
                                        {githubState.exports.map((issue) => (
                                            <li key={issue.id}><a href={issue.url} target="_blank" rel="noreferrer">#{issue.external_issue_id} {issue.title}</a></li>
                                        ))}
                                    </ul>
                                ) : null}
                            </div>
                        </section>
                    </>
                ) : job?.status === 'failed' ? (
                    <section className="panel">
                        <h2>Scan failed</h2>
                        <pre className="logs">{job.logs.join('\n')}</pre>
                    </section>
                ) : job ? (
                    <section className="panel">
                        <h2>Scan in progress</h2>
                        <p>The crawler is discovering pages and generating a baseline report. This view refreshes automatically.</p>
                        <pre className="logs">{job.logs.join('\n')}</pre>
                    </section>
                ) : null}
            </div>
        </>
    );
};

const MetricCard = ({ label, value, helper }) => (
    <article className="metric-card">
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{helper}</span>
    </article>
);

export default hot(module)(App);
