import { report } from '@punyts/core';
import type { Scope } from '../scope/Scope.js';
import { createBinding, type Binding } from './Binding.js';
import type { PlanEntry } from './types.js';

/**
 * Binds on<event>="{{ expr }}". One native listener is added at attach and removed on dispose; it calls whatever
 * function the expression last resolved to, so re-resolving the handler (a bind function such as ($v)=>$.select
 * produces a new bound function on every evaluation) never adds or removes native listeners. A bind function is
 * called with its bound arguments first and the DOM event last, with this === null. Handler errors are reported and
 * never stop the element's other listeners
 * @param node
 * @param entry
 * @param scope
 */
export const attachEvent = (node: Node, entry: PlanEntry, scope: Scope): Binding => {
    //the attribute name minus "on", case preserved, so onMyEvent listens for "MyEvent"
    const eventName = entry.eventName as string;
    let handler: unknown;
    let reportedNotFunction = false;

    const listener = (event: Event) => {
        if (typeof handler !== 'function') {
            if (!reportedNotFunction) {
                reportedNotFunction = true;
                report.error(`[event binding at node path ${JSON.stringify(entry.nodePath)}] ${entry.attrName} did not resolve to a function`, {
                    kind: entry.kind,
                    nodePath: entry.nodePath,
                });
            }
            return;
        }
        try {
            (handler as (event: Event) => unknown)(event);
        }
        catch (error) {
            report.error(`[event binding at node path ${JSON.stringify(entry.nodePath)}] ${entry.attrName} handler failed: ${error instanceof Error ? error.message : String(error)}`, {
                kind: entry.kind,
                nodePath: entry.nodePath,
                error,
            });
        }
    };

    const binding = createBinding({
        scope,
        expressions: entry.parts,
        kind: entry.kind,
        nodePath: entry.nodePath,
        apply: (value) => {
            handler = value;
        },
    });
    node.addEventListener(eventName, listener);

    return {
        get disposed() {
            return binding.disposed;
        },
        update: () => binding.update(),
        rebind: () => binding.rebind(),
        dispose: () => {
            if (binding.disposed) {
                return;
            }
            binding.dispose();
            node.removeEventListener(eventName, listener);
            handler = undefined;
        },
    };
};
