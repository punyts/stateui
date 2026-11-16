import { createStore } from '@punyts/state';
import { mount } from '@punyts/stateui';
//atoms first: a composite's template can use them as soon as it attaches
import './atoms.js';
import './composites.js';

/**
 * One store holds everything the UI shows. Components never own data; they bind to paths in here
 */
const store = createStore({
    theme: 'light',
    accent: '#5b5bd6',
    board: {
        title: 'Launch checklist',
        hideDone: false,
        draft: { label: 'New task', value: '', placeholder: 'What needs doing?' },
        tasks: [
            { id: 1, title: 'Write the release notes', done: false, priority: 'high' },
            { id: 2, title: 'Update the screenshots', done: true, priority: 'low' },
            { id: 3, title: 'Tell the support team', done: false, priority: 'medium' },
        ],
    },
});

const host = document.querySelector('#app')!;
mount(host, store);
host.append(document.createElement('app-shell'));

/**
 * The console stands in for an agent or MCP tool: it only writes to the store, and checks the DOM right after the
 * write returns to show that StateUI patched it synchronously
 */
const json = document.querySelector('#store-json')!;
const log = document.querySelector('#log')!;

const refreshJson = () => {
    json.textContent = JSON.stringify(store.get('$'), null, 2);
};

const boardRoot = () => document.querySelector('app-shell')?.shadowRoot?.querySelector('task-board')?.shadowRoot;

const write = (label: string, fn: () => void) => {
    fn();
    const rows = boardRoot()?.querySelectorAll('li.row').length ?? 0;
    const title = boardRoot()?.querySelector('h2')?.textContent;
    log.textContent = `${label}\n→ immediately after the write: ${rows} rows rendered, heading "${title}"`;
    refreshJson();
};

let agentId = 500;
const actions: Record<string, () => void> = {
    'add-task': () => write('store.replace("$.board.tasks", [...tasks, newTask])', () => {
        const tasks = store.get('$.board.tasks') as { id: number; title: string; done: boolean; priority: string }[];
        store.replace('$.board.tasks', [
            ...tasks.map(({ id, title, done, priority }) => ({ id, title, done, priority })),
            { id: agentId++, title: `Task added by the agent #${agentId - 500}`, done: false, priority: 'high' },
        ]);
    }),
    'rename': () => write('store.state.board.title = "…"', () => {
        store.state.board.title = store.state.board.title === 'Launch checklist' ? 'Renamed by the agent' : 'Launch checklist';
    }),
    'complete-all': () => write('task.done = true for every task', () => {
        for (const task of store.state.board.tasks) {
            task.done = true;
        }
    }),
    'theme': () => write('store.state.theme = "dark" | "light"', () => {
        store.state.theme = store.state.theme === 'dark' ? 'light' : 'dark';
    }),
    'accent': () => write('store.state.accent = random colour', () => {
        store.state.accent = `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;
    }),
};

document.querySelector('#console')!.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest('button')?.dataset.action;
    if (action) {
        actions[action]?.();
    }
});

//UI interactions also write the store; refresh the JSON view after them
for (const type of ['input', 'change', 'click', 'keydown']) {
    host.addEventListener(type, () => queueMicrotask(refreshJson));
}
refreshJson();
