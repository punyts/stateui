import { defineComponent } from '@punyts/stateui';

/**
 * Layer 2: atomics. Two flavours:
 * - presentational atoms (ui-button, ui-badge) hold no state: content comes in through <slot>, variants through host
 *   attributes styled with :host([...]), and events bubble out of the shadow root to the host, where the parent's
 *   template binds them. Because the parent binds the attributes, they are as reactive as the parent's state
 * - stateful atoms (ui-text-field) are scoped to a store object with the state attribute and read $.label, $.value
 * Every colour, radius and space comes from a token (var(--ui-*)) set by app-shell, so atoms never hard-code a theme
 */

defineComponent({
    tag: 'ui-button',
    template: '<button part="control" type="button"><slot></slot></button>',
    styles: `
        :host { display: inline-flex; }
        button {
            font: inherit;
            font-weight: 600;
            padding: var(--ui-space-2) var(--ui-space-3);
            border-radius: var(--ui-radius);
            border: 1px solid transparent;
            background: var(--ui-accent);
            color: var(--ui-on-accent);
            cursor: pointer;
        }
        button:hover { filter: brightness(1.08); }
        button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
        :host([variant=ghost]) button { background: transparent; color: var(--ui-text-muted); border-color: var(--ui-border); }
        :host([variant=ghost]) button:hover { color: var(--ui-text); }
        :host([pressed]) button { background: var(--ui-accent-soft); color: var(--ui-accent); }
        :host([size=small]) button { padding: var(--ui-space-1) var(--ui-space-2); font-size: 0.85em; }
    `,
});

defineComponent({
    tag: 'ui-badge',
    template: '<span class="badge"><slot></slot></span>',
    styles: `
        :host { display: inline-flex; }
        .badge {
            font-size: 0.75em;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            padding: 2px var(--ui-space-2);
            border-radius: 999px;
            background: var(--ui-surface-sunken);
            color: var(--ui-text-muted);
        }
        :host([tone=high]) .badge { background: var(--ui-danger-soft); color: var(--ui-danger); }
        :host([tone=medium]) .badge { background: var(--ui-warning-soft); color: var(--ui-warning); }
        :host([tone=done]) .badge { background: var(--ui-success-soft); color: var(--ui-success); }
    `,
});

defineComponent({
    tag: 'ui-text-field',
    //bind="value" writes every input event back to $.value, i.e. <state path>.value in the store
    template: `
        <label class="field">
            <span class="label">{{ $.label }}</span>
            <input value="{{ $.value }}" placeholder="{{ $.placeholder }}" bind="value" />
        </label>`,
    styles: `
        :host { display: block; flex: 1; }
        .field { display: grid; gap: var(--ui-space-1); }
        .label { font-size: 0.8em; color: var(--ui-text-muted); }
        input {
            font: inherit;
            padding: var(--ui-space-2) var(--ui-space-3);
            border-radius: var(--ui-radius);
            border: 1px solid var(--ui-border);
            background: var(--ui-surface);
            color: var(--ui-text);
        }
        input:focus { outline: 2px solid var(--ui-accent); outline-offset: -1px; }
    `,
});
