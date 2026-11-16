import { defineComponent } from '@punyts/stateui';

interface Task {
    id: number;
    title: string;
    done: boolean;
    priority: 'low' | 'medium' | 'high';
}

const PRIORITIES: Task['priority'][] = ['low', 'medium', 'high'];

//plain copies of the store's task proxies, for store.replace
const copyTasks = (tasks: Task[]): Task[] => tasks.map(({ id, title, done, priority }) => ({ id, title, done, priority }));

/**
 * Layer 3: a composite. task-board is scoped to $.board by its parent (state=".board"), composes the atoms, and owns
 * the behaviour in its controller. The controller's members are scope locals, so the template calls addTask, not
 * $.addTask. Rows are inline markup in a keyed repeat: $v is the row's task, and the atoms inside a row get their
 * attributes and slotted text from the row's bindings
 */
defineComponent({
    tag: 'task-board',
    template: `
        <section class="board">
            <header class="head">
                <h2>{{ $.title }}</h2>
                <ui-badge>{{ $.tasks.length }} tasks</ui-badge>
            </header>
            <div class="add" onkeydown="{{ onDraftKey }}">
                <ui-text-field state=".draft"></ui-text-field>
                <ui-button onclick="{{ addTask }}">Add</ui-button>
            </div>
            <label class="hide"><input type="checkbox" checked="{{ $.hideDone }}" bind="checked" /> Hide completed</label>
            <ul class="list" if="{{ $.tasks.length > 0 }}">
                <li class="row" repeat="{{ $k,$i,$v in $.tasks sort $v.done asc filter !$v.done || !$.hideDone }}" key="{{ $v.id }}" data-done="{{ $v.done }}">
                    <input type="checkbox" checked="{{ $v.done }}" bind="checked" />
                    <span class="title">{{ $v.title }}</span>
                    <ui-badge tone="{{ $v.priority }}" title="Click to change priority" onclick="{{ ($v.id)=>cyclePriority }}">{{ $v.priority }}</ui-badge>
                    <ui-button variant="ghost" size="small" onclick="{{ ($v.id)=>removeTask }}">Remove</ui-button>
                </li>
            </ul>
            <p class="empty" else="">Nothing to do. Add a task above.</p>
        </section>`,
    styles: `
        :host { display: block; }
        .board {
            display: grid;
            gap: var(--ui-space-3);
            padding: var(--ui-space-4);
            border-radius: calc(var(--ui-radius) * 2);
            background: var(--ui-surface);
            border: 1px solid var(--ui-border);
            box-shadow: var(--ui-shadow);
        }
        .head { display: flex; align-items: center; gap: var(--ui-space-2); }
        h2 { margin: 0; font-size: 1.25em; }
        .add { display: flex; align-items: end; gap: var(--ui-space-2); }
        .hide { font-size: 0.85em; color: var(--ui-text-muted); display: flex; gap: var(--ui-space-1); align-items: center; }
        .list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--ui-space-1); }
        .row {
            display: flex;
            align-items: center;
            gap: var(--ui-space-2);
            padding: var(--ui-space-2) var(--ui-space-3);
            border-radius: var(--ui-radius);
            background: var(--ui-surface-sunken);
        }
        .row[data-done] .title { text-decoration: line-through; color: var(--ui-text-muted); }
        .title { flex: 1; }
        ui-badge { cursor: pointer; }
        input[type=checkbox] { accent-color: var(--ui-accent); width: 1.1em; height: 1.1em; }
        .empty { margin: 0; color: var(--ui-text-muted); text-align: center; padding: var(--ui-space-4); }
    `,
    controller: ({ store, basePath, state }) => {
        const board = state as { tasks: Task[]; draft: { value: string } };
        let nextId = 1000;

        const addTask = () => {
            const title = String(board.draft.value ?? '').trim();
            if (!title) {
                return;
            }
            //replace the whole array: one emit for the collection instead of one per touched index
            store.replace(`${basePath}.tasks`, [...copyTasks(board.tasks), { id: nextId++, title, done: false, priority: 'medium' }]);
            board.draft.value = '';
        };

        return {
            addTask,
            onDraftKey: (event: KeyboardEvent) => {
                if (event.key === 'Enter') {
                    addTask();
                }
            },
            removeTask: (id: number) => {
                store.replace(`${basePath}.tasks`, copyTasks(board.tasks).filter((task) => task.id !== id));
            },
            cyclePriority: (id: number) => {
                const task = board.tasks.find((item) => item.id === id);
                if (task) {
                    task.priority = PRIORITIES[(PRIORITIES.indexOf(task.priority) + 1) % PRIORITIES.length];
                }
            },
        };
    },
});

/**
 * Layer 1: the UI system shell. It owns the design tokens as plain CSS custom properties on .app; they inherit through
 * every nested shadow root, so atoms and composites only ever say var(--ui-*). The theme is one class switched by
 * $.theme, and the accent token is the one token bound to state: StateUI sets it as a custom property on the host
 */
defineComponent({
    tag: 'app-shell',
    template: `
        <div class="app {{ $.theme }}">
            <header class="bar">
                <strong>StateUI example</strong>
                <span class="spacer"></span>
                <label class="accent">Accent <input type="color" value="{{ $.accent }}" bind="value" /></label>
                <ui-button variant="ghost" onclick="{{ toggleTheme }}">Toggle theme</ui-button>
            </header>
            <main class="main"><task-board state=".board"></task-board></main>
        </div>`,
    styles: `
        :host { display: block; height: 100%; }
        .app {
            --ui-accent: {{ $.accent }};
            --ui-accent-soft: color-mix(in srgb, var(--ui-accent) 16%, transparent);
            --ui-on-accent: #ffffff;
            --ui-bg: #f4f4f7;
            --ui-surface: #ffffff;
            --ui-surface-sunken: #f0f0f4;
            --ui-border: #dedee6;
            --ui-text: #1b1b22;
            --ui-text-muted: #6a6a78;
            --ui-danger: #c2334a;
            --ui-danger-soft: #fbe3e7;
            --ui-warning: #a15c00;
            --ui-warning-soft: #fdf0d8;
            --ui-success: #1d7a46;
            --ui-success-soft: #dcf3e5;
            --ui-shadow: 0 1px 2px rgb(0 0 0 / 0.06), 0 4px 16px rgb(0 0 0 / 0.04);
            --ui-radius: 8px;
            --ui-space-1: 4px;
            --ui-space-2: 8px;
            --ui-space-3: 12px;
            --ui-space-4: 20px;
            min-height: 100%;
            background: var(--ui-bg);
            color: var(--ui-text);
            font-family: system-ui, sans-serif;
        }
        .app.dark {
            --ui-bg: #111116;
            --ui-surface: #1b1b22;
            --ui-surface-sunken: #24242d;
            --ui-border: #33333f;
            --ui-text: #ececf1;
            --ui-text-muted: #9a9aab;
            --ui-danger: #ff8a9b;
            --ui-danger-soft: #4a1f27;
            --ui-warning: #f5bf62;
            --ui-warning-soft: #43321a;
            --ui-success: #74d69c;
            --ui-success-soft: #1d3a29;
            --ui-shadow: none;
        }
        .bar { display: flex; align-items: center; gap: var(--ui-space-3); padding: var(--ui-space-3) var(--ui-space-4); border-bottom: 1px solid var(--ui-border); }
        .spacer { flex: 1; }
        .accent { display: flex; align-items: center; gap: var(--ui-space-2); font-size: 0.85em; color: var(--ui-text-muted); }
        .accent input { width: 2.25em; height: 1.75em; border: none; padding: 0; background: none; }
        .main { padding: var(--ui-space-4); max-width: 640px; }
    `,
    controller: ({ state }) => ({
        toggleTheme: () => {
            const app = state as { theme: string };
            app.theme = app.theme === 'dark' ? 'light' : 'dark';
        },
    }),
});
