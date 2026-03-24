const API_URL = 'http://localhost:8080';

const parseResponse = async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.message || 'Request failed.');
    }
    return payload;
};

export const createScanJob = async ({ rootUrl, pageLimit, depthLimit }) => {
    const response = await fetch(`${API_URL}/audit-jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootUrl, pageLimit, depthLimit }),
    });
    return parseResponse(response);
};

export const fetchScanJob = async (jobId) => {
    const response = await fetch(`${API_URL}/audit-jobs/${jobId}`);
    return parseResponse(response);
};

export const exportGitHubIssues = async (jobId, payload) => {
    const response = await fetch(`${API_URL}/audit-jobs/${jobId}/github-export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    return parseResponse(response);
};

export const getReportDownloadUrl = (jobId, format) => `${API_URL}/audit-jobs/${jobId}/reports/${format}`;
