import type { EventListenerFn } from '@punyts/state';
import { normalizePath } from '../scope/path.js';
import type { LocalEntry, Scope } from '../scope/Scope.js';
import { classifyVariable } from '../scope/variables.js';
import { instantiate, type TemplateInstance } from '../template/instantiate.js';
import { createBinding, type Binding } from './Binding.js';
import type { RepeatEntryData } from './iterator.js';
import type { PlanEntry } from './types.js';

//the iterator object @punyts/expression returns for "k,i,v in|for ..."
interface ExpressionIterator {
    lookup: { key: string; index?: string; value?: string };
    keys: string[];
    collection: Record<string, unknown>;
}

interface ItemEntry {
    key: string;
    position: number;
    value: unknown;
    path?: string;
}

interface RenderedItem extends ItemEntry {
    scope: Scope;
    instance: TemplateInstance;
    nodes: Node[];
}

const isIterator = (value: unknown): value is ExpressionIterator => {
    return !!value && typeof value === 'object' && Array.isArray((value as ExpressionIterator).keys);
};

/**
 * Returns an item's store path: a store proxy's own __path (right even when filter compacted the array), or
 * <collection>.<key> for a primitive of an unfiltered collection; otherwise none
 * @param value
 * @param key
 * @param collectionPath
 * @param filtered
 */
const getItemPath = (value: unknown, key: string, collectionPath: string | undefined, filtered: boolean) => {
    const proxyPath = value && typeof value === 'object' ? (value as { __isProxy?: boolean; __path?: string }) : undefined;
    if (proxyPath?.__isProxy && typeof proxyPath.__path === 'string') {
        return normalizePath(proxyPath.__path);
    }
    if (collectionPath !== undefined && !filtered) {
        return `${collectionPath}.${key}`;
    }
    return undefined;
};

/**
 * An unkeyed item can be reused when key and path match; an item without a path must also hold the identical value
 * @param item
 * @param entry
 */
const canReuse = (item: RenderedItem, entry: ItemEntry) => {
    return item.key === entry.key
        && item.path === entry.path
        && (item.path !== undefined || Object.is(item.value, entry.value));
};

/**
 * Binds repeat to its anchor comment. Each evaluation yields an iterator; every entry gets a child scope with the
 * iterator locals ($k key, $i position, $v value with its store path when it has one, so item bindings subscribe to
 * their own item only) and an instance of the item template. Unkeyed reconcile: items are reused while (key, path)
 * matches at the same position; from the first mismatch on, items are disposed and recreated, and new items are
 * inserted before the anchor in one operation. A sort or filter reads item fields, so it also listens to every
 * change below the collection (one <collection>.$all listener owned by this binding)
 * @param node - the anchor comment
 * @param entry
 * @param scope
 */
export const attachRepeat = (node: Node, entry: PlanEntry, scope: Scope): Binding => {
    const data = entry as unknown as PlanEntry & RepeatEntryData;
    let items: RenderedItem[] = [];
    let itemListener: { path: string; listener: EventListenerFn } | undefined;

    const resolveCollectionPath = () => {
        if (data.collection === undefined) {
            return undefined;
        }
        const classified = classifyVariable(data.collection, scope);
        return classified?.kind === 'store' ? classified.path : undefined;
    };

    const disposeItem = (item: RenderedItem) => {
        item.instance.dispose();
        for (const itemNode of item.nodes) {
            itemNode.parentNode?.removeChild(itemNode);
        }
    };

    const createItem = (iterator: ExpressionIterator, itemEntry: ItemEntry): RenderedItem => {
        const { lookup } = iterator;
        const locals: Record<string, LocalEntry> = { [lookup.key]: { value: itemEntry.key } };
        if (lookup.index) {
            locals[lookup.index] = { value: itemEntry.position };
        }
        if (lookup.value) {
            locals[lookup.value] = itemEntry.path !== undefined ? { path: itemEntry.path } : { value: itemEntry.value };
        }
        const itemScope = scope.child(locals, itemEntry.path !== undefined ? { ancestorFloor: itemEntry.path } : {});
        const instance = instantiate(data.item, itemScope);
        return { ...itemEntry, scope: itemScope, instance, nodes: Array.from(instance.fragment.childNodes) };
    };

    const reconcile = (value: unknown) => {
        const iterator = isIterator(value) ? value : undefined;
        const collectionPath = resolveCollectionPath();
        const entries: ItemEntry[] = (iterator?.keys ?? []).map((key, position) => {
            const itemValue = iterator!.collection[key];
            return { key, position, value: itemValue, path: getItemPath(itemValue, key, collectionPath, data.filtered) };
        });

        let firstChanged = 0;
        while (firstChanged < items.length && firstChanged < entries.length && canReuse(items[firstChanged], entries[firstChanged])) {
            firstChanged++;
        }
        for (const item of items.slice(firstChanged)) {
            disposeItem(item);
        }

        const kept = items.slice(0, firstChanged);
        const created = entries.slice(firstChanged).map((itemEntry) => createItem(iterator!, itemEntry));
        if (created.length) {
            const fragment = node.ownerDocument!.createDocumentFragment();
            for (const item of created) {
                for (const itemNode of item.nodes) {
                    fragment.appendChild(itemNode);
                }
            }
            node.parentNode!.insertBefore(fragment, node);
        }
        items = [...kept, ...created];
    };

    const binding = createBinding({
        scope,
        expressions: entry.parts,
        kind: entry.kind,
        nodePath: entry.nodePath,
        apply: reconcile,
    });

    //sort and filter read item fields, which only emit on item paths
    const listenToItems = () => {
        const collectionPath = data.readsItems ? resolveCollectionPath() : undefined;
        if (itemListener?.path === collectionPath) {
            return;
        }
        if (itemListener) {
            scope.store.off(itemListener.path, itemListener.listener);
            itemListener = undefined;
        }
        if (collectionPath !== undefined) {
            const listener: EventListenerFn = () => binding.update();
            scope.store.on(`${collectionPath}.$all`, listener);
            itemListener = { path: `${collectionPath}.$all`, listener };
        }
    };
    listenToItems();

    return {
        get disposed() {
            return binding.disposed;
        },
        update: () => binding.update(),
        rebind: () => {
            listenToItems();
            binding.rebind();
        },
        dispose: () => {
            if (binding.disposed) {
                return;
            }
            binding.dispose();
            if (itemListener) {
                scope.store.off(itemListener.path, itemListener.listener);
                itemListener = undefined;
            }
            for (const item of items) {
                disposeItem(item);
            }
            items = [];
        },
    };
};
