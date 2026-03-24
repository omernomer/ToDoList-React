import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import uuid from 'uuid';
import path from 'path';
import {
    createAuditJob,
    createGitHubIssues,
    getAuditJob,
    listAuditJobs,
    reportFilePath,
} from './audit';

let fakeTodos = [{
    id: 'ae06181d-92c2-4fed-a29d-fb53a6301eb9',
    text: 'Learn about React Ecosystems',
    isCompleted: false,
    createdAt: new Date(),
}, {
    id: 'cda9165d-c263-4ef6-af12-3f1271af5fb4',
    text: 'Get together with friends',
    isCompleted: false,
    createdAt: new Date(Date.now() - 86400000 * 7),
}, {
    id: '2e538cc5-b734-4771-a109-dfcd204bb38b',
    text: 'Buy groceries',
    isCompleted: true,
    createdAt: new Date(Date.now() - 86400000 * 14),
}];

const app = express();

app.use(bodyParser.json({ limit: '1mb' }));
app.use(cors());
app.use('/artifacts', express.static(path.resolve(process.cwd(), 'data')));

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

app.get('/audit-jobs', (req, res) => {
    res.status(200).json(listAuditJobs());
});

app.post('/audit-jobs', (req, res) => {
    try {
        const { rootUrl, pageLimit, depthLimit } = req.body;
        if (!rootUrl) {
            res.status(400).json({ message: 'rootUrl is required.' });
            return;
        }
        const url = new URL(rootUrl);
        if (!/^https?:$/.test(url.protocol)) {
            res.status(400).json({ message: 'Only http and https URLs are supported.' });
            return;
        }
        const job = createAuditJob({ rootUrl: url.toString(), pageLimit, depthLimit });
        res.status(202).json(job);
    } catch (error) {
        res.status(400).json({ message: error.message || 'Invalid rootUrl.' });
    }
});

app.get('/audit-jobs/:id', (req, res) => {
    const job = getAuditJob(req.params.id);
    if (!job) {
        res.status(404).json({ message: 'Audit job not found.' });
        return;
    }
    res.status(200).json(job);
});

app.get('/audit-jobs/:id/reports/:format', (req, res) => {
    const job = getAuditJob(req.params.id);
    const supportedFormats = ['json', 'csv', 'pdf'];
    if (!job) {
        res.status(404).json({ message: 'Audit job not found.' });
        return;
    }
    if (!supportedFormats.includes(req.params.format)) {
        res.status(400).json({ message: 'Unsupported report format.' });
        return;
    }
    const filePath = reportFilePath(req.params.id, req.params.format);
    res.download(filePath, `accessibility-report-${req.params.id}.${req.params.format}`);
});

app.post('/audit-jobs/:id/github-export', async (req, res) => {
    try {
        const exports = await createGitHubIssues({
            jobId: req.params.id,
            repoOwner: req.body.repoOwner,
            repoName: req.body.repoName,
            token: req.body.token,
        });
        res.status(200).json({ exports });
    } catch (error) {
        res.status(400).json({ message: error.message || 'GitHub export failed.' });
    }
});

// The route for getting a list of all todos
app.get('/todos', (req, res) => {
    res.status(200).json(fakeTodos);
});

// The route for getting a list of all todos, but with a delay
// (to display the loading component better)
app.get('/todos-delay', (req, res) => {
    setTimeout(() => res.status(200).json(fakeTodos), 2000);
});

// The route for creating new todo-list items
app.post('/todos', (req, res) => {
    const { text } = req.body;
    if (text) {
        const insertedTodo = {
            id: uuid(),
            createdAt: Date.now(),
            isCompleted: false,
            text,
        };
        fakeTodos.push(insertedTodo);
        res.status(200).json(insertedTodo);
    } else {
        res.status(400).json({ message: 'Request body should have a text property' });
    }
});

app.post('/todos/:id/completed', (req, res) => {
    const { id } = req.params;
    const matchingTodo = fakeTodos.find(todo => todo.id === id);
    const updatedTodo = matchingTodo ? {
        ...matchingTodo,
        isCompleted: true,
    } : null;
    if (updatedTodo) {
        fakeTodos = fakeTodos.map(todo => (
            todo.id === id
                ? updatedTodo
                : todo
        ));
        res.status(200).json(updatedTodo);
    } else {
        res.status(400).json({ message: 'There is no todo with that id' });
    }
});

// The route for deleting a todo-list item
app.delete('/todos/:id', (req, res) => {
    const { id } = req.params;
    const removedTodo = fakeTodos.find(todo => todo.id === id);
    fakeTodos = fakeTodos.filter(todo => todo.id !== id);
    res.status(200).json(removedTodo);
});

app.listen(8080, () => console.log('Server listening on port 8080'));
