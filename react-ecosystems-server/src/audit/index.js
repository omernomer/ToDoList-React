import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { URL } from 'url';
import { IMPACT_WEIGHTS, RULE_DEFINITIONS } from './rules';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SCREENSHOT_DIR = path.join(DATA_DIR, 'screenshots');
const REPORT_DIR = path.join(DATA_DIR, 'reports');
const jobs = new Map();

const ensureDir = (dirPath) => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
};

ensureDir(DATA_DIR);
ensureDir(SCREENSHOT_DIR);
ensureDir(REPORT_DIR);

const textFromHtml = (html = '') => html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const decodeAttribute = (value = '') => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

const fetchText = (targetUrl, redirects = 0) => new Promise((resolve, reject) => {
    const client = targetUrl.startsWith('https') ? https : http;
    const request = client.get(targetUrl, {
        headers: {
            'User-Agent': 'AccessibilityBaselineBot/1.0',
            'Accept': 'text/html,application/xhtml+xml',
        },
    }, (response) => {
        const statusCode = response.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location && redirects < 3) {
            const redirectedUrl = new URL(response.headers.location, targetUrl).toString();
            response.resume();
            resolve(fetchText(redirectedUrl, redirects + 1));
            return;
        }

        if (statusCode >= 400) {
            reject(new Error(`Request failed with status ${statusCode}`));
            response.resume();
            return;
        }

        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
            resolve({
                html: Buffer.concat(chunks).toString('utf8'),
                statusCode,
                finalUrl: targetUrl,
                contentType: response.headers['content-type'] || '',
            });
        });
    });

    request.on('error', reject);
    request.setTimeout(15000, () => request.destroy(new Error('Request timed out')));
});

const fetchRobots = async (rootUrl) => {
    try {
        const robotsUrl = new URL('/robots.txt', rootUrl).toString();
        const { html } = await fetchText(robotsUrl);
        const disallowed = html
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => /^Disallow:/i.test(line))
            .map(line => line.split(':')[1].trim())
            .filter(Boolean);
        return disallowed;
    } catch (error) {
        return [];
    }
};

const isDisallowed = (pathname, disallowedPaths) => disallowedPaths.some(rule => rule !== '/' && pathname.startsWith(rule));

const normalizeUrl = (rawUrl) => {
    const parsedUrl = new URL(rawUrl);
    parsedUrl.hash = '';
    if ((parsedUrl.protocol === 'https:' && parsedUrl.port === '443') || (parsedUrl.protocol === 'http:' && parsedUrl.port === '80')) {
        parsedUrl.port = '';
    }
    return parsedUrl.toString().replace(/\/$/, '') || parsedUrl.toString();
};

const extractLinks = (html, currentUrl, rootHost) => {
    const matches = [...html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>/gi)];
    return matches
        .map(match => match[1])
        .filter(Boolean)
        .map(href => {
            try {
                return normalizeUrl(new URL(href, currentUrl).toString());
            } catch (error) {
                return null;
            }
        })
        .filter(link => link && new URL(link).host === rootHost);
};

const detectFindings = ({ html, pageUrl, pageId, scanJobId, screenshotPath }) => {
    const findings = [];
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const titleText = titleMatch ? textFromHtml(titleMatch[1]) : '';
    const langMatch = html.match(/<html[^>]*\slang=["']([^"']+)["'][^>]*>/i);

    if (!titleText) {
        findings.push(createFinding('document-title', 'head > title', '<title></title>'));
    }

    if (!langMatch) {
        findings.push(createFinding('html-lang', 'html', '<html>'));
    }

    const imageMatches = [...html.matchAll(/<img\b([^>]*)>/gi)];
    imageMatches.forEach((match, index) => {
        const attrs = match[1] || '';
        const altMatch = attrs.match(/\salt=["']([^"']*)["']/i);
        if (!altMatch) {
            findings.push(createFinding('image-alt', `img:nth-of-type(${index + 1})`, match[0]));
        }
    });

    const controlMatches = [...html.matchAll(/<(input|textarea|select)\b([^>]*)>/gi)];
    controlMatches.forEach((match, index) => {
        const tagName = match[1].toLowerCase();
        const attrs = match[2] || '';
        const typeMatch = attrs.match(/\stype=["']([^"']+)["']/i);
        const inputType = typeMatch ? typeMatch[1].toLowerCase() : 'text';
        if (tagName === 'input' && ['hidden', 'submit', 'button', 'reset'].includes(inputType)) {
            return;
        }

        const idMatch = attrs.match(/\sid=["']([^"']+)["']/i);
        const ariaLabelMatch = attrs.match(/aria-label=["']([^"']+)["']/i);
        const ariaLabelledByMatch = attrs.match(/aria-labelledby=["']([^"']+)["']/i);
        const placeholderMatch = attrs.match(/placeholder=["']([^"']+)["']/i);
        const hasTitle = /\stitle=["'][^"']+["']/i.test(attrs);
        const labelRegex = idMatch ? new RegExp(`<label[^>]+for=["']${idMatch[1]}["'][^>]*>[\\s\\S]*?<\\/label>`, 'i') : null;
        const wrappedLabelRegex = new RegExp(`<label[^>]*>[\\s\\S]*?${escapeRegExp(match[0])}[\\s\\S]*?<\\/label>`, 'i');
        const hasLabel = Boolean(
            ariaLabelMatch ||
            ariaLabelledByMatch ||
            hasTitle ||
            (labelRegex && labelRegex.test(html)) ||
            wrappedLabelRegex.test(html)
        );

        if (!hasLabel && !placeholderMatch) {
            findings.push(createFinding('form-label', `${tagName}:nth-of-type(${index + 1})`, match[0]));
        }
    });

    const buttonMatches = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)];
    buttonMatches.forEach((match, index) => {
        const attrs = match[1] || '';
        const textContent = textFromHtml(match[2]);
        const ariaLabel = attrs.match(/aria-label=["']([^"']+)["']/i);
        const ariaLabelledBy = attrs.match(/aria-labelledby=["']([^"']+)["']/i);
        if (!textContent && !ariaLabel && !ariaLabelledBy) {
            findings.push(createFinding('button-name', `button:nth-of-type(${index + 1})`, match[0]));
        }
    });

    const linkMatches = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
    linkMatches.forEach((match, index) => {
        const attrs = match[1] || '';
        const textContent = textFromHtml(match[2]);
        const ariaLabel = attrs.match(/aria-label=["']([^"']+)["']/i);
        if (!textContent && !ariaLabel) {
            findings.push(createFinding('link-name', `a:nth-of-type(${index + 1})`, match[0]));
        }
    });

    const headingMatches = [...html.matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(match => Number(match[1][1]));
    for (let index = 1; index < headingMatches.length; index += 1) {
        if (headingMatches[index] - headingMatches[index - 1] > 1) {
            findings.push(createFinding('heading-order', `h${headingMatches[index]}`, `<h${headingMatches[index]}>...</h${headingMatches[index]}>`));
            break;
        }
    }

    return { findings, titleText, pageLang: langMatch ? decodeAttribute(langMatch[1]) : '' };

    function createFinding(ruleId, selector, htmlSnippet) {
        const metadata = RULE_DEFINITIONS[ruleId];
        return {
            id: crypto.randomUUID(),
            scan_job_id: scanJobId,
            page_id: pageId,
            source: 'heuristic',
            rule_id: ruleId,
            rule_name: metadata.ruleName,
            impact: metadata.impact,
            wcag_refs: metadata.wcagRefs,
            selector,
            html_snippet: htmlSnippet.slice(0, 240),
            help: metadata.help,
            help_url: metadata.helpUrl,
            screenshot_path: screenshotPath,
            page_url: pageUrl,
            why_it_matters: metadata.whyItMatters,
            suggested_fix: metadata.suggestedFix,
            code_example: metadata.codeExample,
        };
    }
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const createScreenshot = (scanJobId, page, status) => {
    const filename = `${scanJobId}-${page.id}.svg`;
    const filePath = path.join(SCREENSHOT_DIR, filename);
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#0f172a" />
  <rect x="80" y="80" width="1120" height="560" rx="24" fill="#111827" stroke="#38bdf8" stroke-width="2" />
  <text x="120" y="170" fill="#38bdf8" font-size="28" font-family="Arial, sans-serif">Automated baseline evidence snapshot</text>
  <text x="120" y="240" fill="#f8fafc" font-size="40" font-family="Arial, sans-serif">${escapeXml(page.title || page.url)}</text>
  <text x="120" y="310" fill="#cbd5e1" font-size="26" font-family="Arial, sans-serif">${escapeXml(page.url)}</text>
  <text x="120" y="390" fill="#fbbf24" font-size="26" font-family="Arial, sans-serif">Status: ${escapeXml(status)}</text>
  <text x="120" y="460" fill="#94a3b8" font-size="24" font-family="Arial, sans-serif">Generated without a headless browser in this environment.</text>
  <text x="120" y="500" fill="#94a3b8" font-size="24" font-family="Arial, sans-serif">Use this artifact as crawl evidence rather than a visual pixel-perfect screenshot.</text>
</svg>`;
    fs.writeFileSync(filePath, svg.trim());
    return `/artifacts/screenshots/${filename}`;
};

const escapeXml = (value = '') => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const pageImportance = (pageUrl, rootUrl) => {
    const pathname = new URL(pageUrl).pathname.toLowerCase();
    if (normalizeUrl(pageUrl) === normalizeUrl(rootUrl) || pathname === '') {
        return 1.5;
    }
    if (/(contact|signup|sign-up|register|login|checkout|cart|pricing|subscribe|form)/.test(pathname)) {
        return 1.4;
    }
    if (/(about|features|product|services)/.test(pathname)) {
        return 1.2;
    }
    return 1;
};

const buildFingerprint = (finding) => crypto
    .createHash('sha1')
    .update(`${finding.rule_id}|${finding.selector.replace(/:nth-of-type\(\d+\)/g, '')}|${finding.help}`)
    .digest('hex');

const groupFindings = (findings, pagesById, rootUrl) => {
    const grouped = new Map();
    findings.forEach(finding => {
        const fingerprint = buildFingerprint(finding);
        const page = pagesById[finding.page_id];
        const metadata = RULE_DEFINITIONS[finding.rule_id];
        const existing = grouped.get(fingerprint);
        const occurrence = {
            page_id: finding.page_id,
            page_url: finding.page_url,
            selector: finding.selector,
            screenshot_path: finding.screenshot_path,
            html_snippet: finding.html_snippet,
        };
        if (existing) {
            existing.occurrences.push(occurrence);
            existing.page_urls.push(finding.page_url);
            existing.priority_score = computePriority(existing.impact, existing.page_urls.length, existing.page_urls, rootUrl, metadata.userImpactBoost);
            return;
        }
        grouped.set(fingerprint, {
            id: crypto.randomUUID(),
            fingerprint,
            source: finding.source,
            rule_id: finding.rule_id,
            rule_name: finding.rule_name,
            impact: finding.impact,
            wcag_refs: finding.wcag_refs,
            help: finding.help,
            help_url: finding.help_url,
            why_it_matters: finding.why_it_matters,
            suggested_fix: finding.suggested_fix,
            code_example: finding.code_example,
            page_urls: [finding.page_url],
            page_count: 1,
            occurrences: [occurrence],
            screenshot_path: finding.screenshot_path,
            priority_score: computePriority(finding.impact, 1, [finding.page_url], rootUrl, metadata.userImpactBoost),
            status: 'open',
            page_title: page ? page.title : finding.page_url,
            selector: finding.selector,
        });
    });

    return [...grouped.values()]
        .map(group => ({ ...group, page_count: new Set(group.page_urls).size }))
        .sort((left, right) => right.priority_score - left.priority_score);
};

const computePriority = (impact, recurrence, pageUrls, rootUrl, userImpactBoost = 1) => {
    const severityWeight = IMPACT_WEIGHTS[impact] || 1;
    const highestImportance = Math.max(...pageUrls.map(url => pageImportance(url, rootUrl)));
    const recurrenceScore = Math.max(1, Math.log2(recurrence + 1) + 1);
    return Number((severityWeight * highestImportance * recurrenceScore * userImpactBoost).toFixed(2));
};

const createSummary = ({ scanJob, pages, groupedFindings, previousJob }) => {
    const severities = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    groupedFindings.forEach(group => { severities[group.impact] += 1; });
    const totalFindings = groupedFindings.length;
    const scorePenalty = (severities.critical * 18) + (severities.serious * 9) + (severities.moderate * 4) + (severities.minor * 2);
    const overallScore = Math.max(0, Math.round(100 - scorePenalty / Math.max(1, pages.length)));
    const principleCounts = groupedFindings.reduce((accumulator, finding) => {
        finding.wcag_refs.forEach(reference => {
            const principle = reference.split(' ')[1]?.split('.')[0] || 'Other';
            accumulator[principle] = (accumulator[principle] || 0) + 1;
        });
        return accumulator;
    }, {});

    const pageBreakdown = pages.map(page => ({
        ...page,
        issue_count: groupedFindings.filter(group => group.page_urls.includes(page.url)).length,
        severity_counts: groupedFindings.reduce((accumulator, group) => {
            if (group.page_urls.includes(page.url)) {
                accumulator[group.impact] += 1;
            }
            return accumulator;
        }, { critical: 0, serious: 0, moderate: 0, minor: 0 }),
    })).sort((left, right) => right.issue_count - left.issue_count);

    return {
        overall_score: overallScore,
        total_findings: totalFindings,
        severity_counts: severities,
        principle_counts: principleCounts,
        top_issues: groupedFindings.slice(0, 5),
        trend: previousJob ? {
            previous_score: previousJob.summary.overall_score,
            score_delta: overallScore - previousJob.summary.overall_score,
            findings_delta: totalFindings - previousJob.summary.total_findings,
        } : null,
        page_breakdown: pageBreakdown,
        disclaimer: 'Automated baseline only. Manual accessibility review is still required and this report is not legal advice.',
        scan_limits: {
            page_limit: scanJob.page_limit,
            depth_limit: scanJob.depth_limit,
        },
    };
};

const serializeCsv = (groupedFindings) => {
    const header = ['rule_id', 'impact', 'page_count', 'priority_score', 'wcag_refs', 'selector', 'pages', 'suggested_fix'];
    const rows = groupedFindings.map(finding => [
        finding.rule_id,
        finding.impact,
        String(finding.page_count),
        String(finding.priority_score),
        finding.wcag_refs.join('; '),
        finding.selector,
        finding.page_urls.join('; '),
        finding.suggested_fix,
    ]);
    return [header, ...rows].map(columns => columns.map(toCsvValue).join(',')).join('\n');
};

const toCsvValue = (value = '') => {
    const stringValue = String(value).replace(/"/g, '""');
    return /[",\n]/.test(stringValue) ? `"${stringValue}"` : stringValue;
};

const buildPdfBuffer = (job) => {
    const lines = [
        `Accessibility baseline report`,
        `Root URL: ${job.root_url}`,
        `Score: ${job.summary.overall_score}`,
        `Total grouped findings: ${job.summary.total_findings}`,
        `Critical: ${job.summary.severity_counts.critical}`,
        `Serious: ${job.summary.severity_counts.serious}`,
        `Moderate: ${job.summary.severity_counts.moderate}`,
        `Minor: ${job.summary.severity_counts.minor}`,
        `Disclaimer: ${job.summary.disclaimer}`,
        `Top issues:`,
        ...job.grouped_findings.slice(0, 5).map((finding, index) => `${index + 1}. [${finding.impact}] ${finding.rule_name} (${finding.page_count} pages)`),
    ];
    const contentStream = `BT\n/F1 12 Tf\n50 780 Td\n14 TL\n${lines.map(line => `(${escapePdf(line)}) Tj\nT*`).join('')}\nET`;
    const objects = [];
    const addObject = (body) => {
        objects.push(body);
        return objects.length;
    };
    const catalogId = addObject('<< /Type /Catalog /Pages 2 0 R >>');
    const pagesId = addObject('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    const pageId = addObject('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');
    const streamId = addObject(`<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}\nendstream`);
    const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

    const header = '%PDF-1.4\n';
    let body = '';
    const offsets = [0];
    objects.forEach((objectBody, index) => {
        offsets.push(Buffer.byteLength(header + body, 'utf8'));
        body += `${index + 1} 0 obj\n${objectBody}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(header + body, 'utf8');
    const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\n`;
    const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(header + body + xref + trailer, 'utf8');
};

const escapePdf = (value = '') => value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const buildIssuePayloads = (job) => job.grouped_findings.map(finding => ({
    title: `[a11y][${finding.impact}] ${finding.rule_name} on ${finding.page_count} page${finding.page_count === 1 ? '' : 's'}`,
    body: [
        '## Summary',
        `${finding.rule_name}`,
        '',
        '## Impacted pages',
        ...finding.page_urls.map(url => `- ${url}`),
        '',
        '## WCAG references',
        ...finding.wcag_refs.map(reference => `- ${reference}`),
        '',
        '## Reproduction steps',
        '1. Open one of the impacted pages.',
        '2. Inspect selector `' + finding.selector + '`.',
        '3. Confirm the reported accessibility problem exists.',
        '',
        '## Selector examples',
        ...finding.occurrences.slice(0, 3).map(occurrence => `- ${occurrence.selector} on ${occurrence.page_url}`),
        '',
        '## Screenshot links',
        ...finding.occurrences.slice(0, 3).map(occurrence => `- ${occurrence.screenshot_path}`),
        '',
        '## Suggested fix',
        finding.suggested_fix,
        '',
        '## Acceptance criteria',
        '- The affected element has an accessible name/structure that satisfies the mapped WCAG criteria.',
        '- The issue no longer appears in the next automated baseline scan.',
        '',
        '> Automated audit only. Manual accessibility review is still required.',
    ].join('\n'),
}));

export const createAuditJob = ({ rootUrl, pageLimit = 10, depthLimit = 1 }) => {
    const normalizedRootUrl = normalizeUrl(rootUrl);
    const job = {
        id: crypto.randomUUID(),
        workspace_id: 'default',
        root_url: normalizedRootUrl,
        status: 'queued',
        started_at: null,
        completed_at: null,
        page_limit: Math.min(Math.max(Number(pageLimit) || 10, 1), 25),
        depth_limit: Math.min(Math.max(Number(depthLimit) || 1, 0), 3),
        scanned_pages: [],
        findings: [],
        grouped_findings: [],
        summary: null,
        issue_exports: [],
        report_paths: {},
        logs: [],
        manual_review_items: [
            'Verify keyboard access and focus order for menus, dialogs, and custom widgets.',
            'Manually test color contrast for styled components and text inside images.',
            'Confirm error messaging, focus management, and status announcements in dynamic flows.',
        ],
    };
    jobs.set(job.id, job);
    process.nextTick(() => runAuditJob(job.id));
    return job;
};

const findPreviousJob = (job) => [...jobs.values()]
    .filter(candidate => candidate.id !== job.id && candidate.root_url === job.root_url && candidate.summary)
    .sort((left, right) => new Date(right.completed_at) - new Date(left.completed_at))[0];

const runAuditJob = async (jobId) => {
    const job = jobs.get(jobId);
    if (!job) {
        return;
    }

    job.status = 'running';
    job.started_at = new Date().toISOString();
    job.logs.push(`Started scan for ${job.root_url}`);

    try {
        const rootHost = new URL(job.root_url).host;
        const disallowedPaths = await fetchRobots(job.root_url);
        const queue = [{ url: job.root_url, depth: 0 }];
        const seen = new Set();

        while (queue.length && job.scanned_pages.length < job.page_limit) {
            const current = queue.shift();
            const normalizedUrl = normalizeUrl(current.url);
            if (seen.has(normalizedUrl)) {
                continue;
            }
            seen.add(normalizedUrl);

            const pathname = new URL(normalizedUrl).pathname;
            if (isDisallowed(pathname, disallowedPaths)) {
                job.logs.push(`Skipped ${normalizedUrl} due to robots.txt`);
                continue;
            }

            let pageRecord = {
                id: crypto.randomUUID(),
                scan_job_id: job.id,
                url: normalizedUrl,
                canonical_url: normalizedUrl,
                title: normalizedUrl,
                status_code: 0,
                screenshot_path: '',
                lighthouse_score: null,
                scanned_at: new Date().toISOString(),
            };

            try {
                const response = await fetchText(normalizedUrl);
                if (!/text\/html/i.test(response.contentType) && response.contentType) {
                    job.logs.push(`Skipped non-HTML content at ${normalizedUrl}`);
                    continue;
                }
                const { findings, titleText } = detectFindings({
                    html: response.html,
                    pageUrl: normalizedUrl,
                    pageId: pageRecord.id,
                    scanJobId: job.id,
                    screenshotPath: '',
                });
                pageRecord = {
                    ...pageRecord,
                    title: titleText || normalizedUrl,
                    status_code: response.statusCode,
                    lighthouse_score: Math.max(0, 100 - (findings.length * 8)),
                };
                pageRecord.screenshot_path = createScreenshot(job.id, pageRecord, 'crawled');
                const pageFindings = findings.map(finding => ({ ...finding, screenshot_path: pageRecord.screenshot_path }));
                job.scanned_pages.push(pageRecord);
                job.findings.push(...pageFindings);
                job.logs.push(`Scanned ${normalizedUrl} and found ${pageFindings.length} issues`);

                if (current.depth < job.depth_limit) {
                    const links = extractLinks(response.html, normalizedUrl, rootHost);
                    links.forEach(link => {
                        if (!seen.has(link) && queue.length + job.scanned_pages.length < job.page_limit * 3) {
                            queue.push({ url: link, depth: current.depth + 1 });
                        }
                    });
                }
            } catch (error) {
                pageRecord.status_code = 0;
                pageRecord.screenshot_path = createScreenshot(job.id, pageRecord, `error: ${error.message}`);
                pageRecord.scan_error = error.message;
                job.scanned_pages.push(pageRecord);
                job.logs.push(`Failed ${normalizedUrl}: ${error.message}`);
            }
        }

        const pagesById = job.scanned_pages.reduce((accumulator, page) => ({ ...accumulator, [page.id]: page }), {});
        job.grouped_findings = groupFindings(job.findings, pagesById, job.root_url);
        const previousJob = findPreviousJob(job);
        job.summary = createSummary({ scanJob: job, pages: job.scanned_pages, groupedFindings: job.grouped_findings, previousJob });
        writeReports(job);
        job.status = 'completed';
        job.completed_at = new Date().toISOString();
        job.logs.push('Scan completed');
    } catch (error) {
        job.status = 'failed';
        job.completed_at = new Date().toISOString();
        job.logs.push(`Scan failed: ${error.message}`);
    }
};

const writeReports = (job) => {
    const payload = {
        scan_job: {
            id: job.id,
            root_url: job.root_url,
            status: job.status,
            started_at: job.started_at,
            completed_at: job.completed_at,
            page_limit: job.page_limit,
            depth_limit: job.depth_limit,
        },
        summary: job.summary,
        scanned_pages: job.scanned_pages,
        grouped_findings: job.grouped_findings,
        manual_review_items: job.manual_review_items,
    };
    const jsonPath = path.join(REPORT_DIR, `${job.id}.json`);
    const csvPath = path.join(REPORT_DIR, `${job.id}.csv`);
    const pdfPath = path.join(REPORT_DIR, `${job.id}.pdf`);
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
    fs.writeFileSync(csvPath, serializeCsv(job.grouped_findings));
    fs.writeFileSync(pdfPath, buildPdfBuffer({ ...job, summary: job.summary }));
    job.report_paths = {
        json: `/artifacts/reports/${job.id}.json`,
        csv: `/artifacts/reports/${job.id}.csv`,
        pdf: `/artifacts/reports/${job.id}.pdf`,
    };
};

export const getAuditJob = (jobId) => jobs.get(jobId) || null;
export const listAuditJobs = () => [...jobs.values()].sort((left, right) => new Date(right.started_at || 0) - new Date(left.started_at || 0));

export const createGitHubIssues = ({ jobId, repoOwner, repoName, token }) => new Promise((resolve, reject) => {
    const job = jobs.get(jobId);
    if (!job || !job.grouped_findings.length) {
        reject(new Error('No grouped findings available for export.'));
        return;
    }
    if (!repoOwner || !repoName || !token) {
        reject(new Error('repoOwner, repoName, and token are required.'));
        return;
    }

    const issuePayloads = buildIssuePayloads(job).slice(0, 10);
    const exports = [];
    let completed = 0;

    issuePayloads.forEach(issue => {
        const requestBody = JSON.stringify({ title: issue.title, body: issue.body });
        const request = https.request({
            method: 'POST',
            hostname: 'api.github.com',
            path: `/repos/${repoOwner}/${repoName}/issues`,
            headers: {
                'User-Agent': 'AccessibilityBaselineBot/1.0',
                'Accept': 'application/vnd.github+json',
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody),
            },
        }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                if (response.statusCode >= 400) {
                    reject(new Error(body.message || 'GitHub issue creation failed.'));
                    return;
                }
                exports.push({
                    id: crypto.randomUUID(),
                    finding_id: issue.title,
                    provider: 'github',
                    external_issue_id: body.number,
                    exported_at: new Date().toISOString(),
                    url: body.html_url,
                    title: body.title,
                });
                completed += 1;
                if (completed === issuePayloads.length) {
                    job.issue_exports.push(...exports);
                    resolve(exports);
                }
            });
        });
        request.on('error', reject);
        request.write(requestBody);
        request.end();
    });
});

export const reportFilePath = (jobId, format) => path.join(REPORT_DIR, `${jobId}.${format}`);
export const screenshotFilePath = (filename) => path.join(SCREENSHOT_DIR, filename);
