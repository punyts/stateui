import { report } from '@punyts/core';
import { findMountRoot, findParentScope, isBeneath } from './context.js';
import type { ScopeConsumer } from './types.js';

//consumers that connected before any scope was resolvable for them
const waiting: Set<ScopeConsumer> = new Set();
//consumers that are attached, so unmount can detach the ones its root owns
const attached: Set<ScopeConsumer> = new Set();

/**
 * Parks a consumer until a mount above it makes a scope resolvable. Emits one debug report: waiting is normal (e.g.
 * components defined before the app calls mount), not an error
 * @param consumer
 */
export const registerWaiting = (consumer: ScopeConsumer): void => {
    if (waiting.has(consumer)) {
        return;
    }
    waiting.add(consumer);
    report('stateui-waiting', `<${consumer.element.localName}> is waiting for a mounted store above it`);
};

export const unregisterWaiting = (consumer: ScopeConsumer): void => {
    waiting.delete(consumer);
};

/**
 * Attaches a consumer that just connected if a scope is resolvable, otherwise parks it in the waiting set
 * @param consumer
 */
export const connectConsumer = (consumer: ScopeConsumer): void => {
    if (findParentScope(consumer.element)) {
        attached.add(consumer);
        consumer.attach();
        return;
    }
    registerWaiting(consumer);
};

/**
 * Detaches a consumer that just disconnected and removes it from both sets
 * @param consumer
 */
export const disconnectConsumer = (consumer: ScopeConsumer): void => {
    unregisterWaiting(consumer);
    if (attached.delete(consumer)) {
        consumer.detach();
    }
};

/**
 * Attaches every waiting consumer below host whose scope now resolves (called by mount)
 * @param host
 */
export const attachWaitingBeneath = (host: Element): void => {
    for (const consumer of [...waiting]) {
        if (isBeneath(consumer.element, host) && findParentScope(consumer.element)) {
            waiting.delete(consumer);
            attached.add(consumer);
            consumer.attach();
        }
    }
};

/**
 * Detaches every attached consumer whose nearest mounted root is host, runs forget (which removes the mount), then
 * returns still-connected consumers to the waiting set (called by unmount)
 * @param host
 * @param forget
 */
export const detachAttachedOwnedBy = (host: Element, forget: () => void): void => {
    const owned = [...attached].filter((consumer) => findMountRoot(consumer.element) === host);
    for (const consumer of owned) {
        attached.delete(consumer);
        consumer.detach();
    }
    forget();
    for (const consumer of owned) {
        if (consumer.element.isConnected) {
            registerWaiting(consumer);
        }
    }
};
