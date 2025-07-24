import { useState, useEffect, useRef } from 'react';
import { createStore, ProxyObject, resolveRelativePath, Store, validatePath } from './Store';
import { deepDereference } from '../utils/Dereference';
import { report } from '../logging/Reporter';
import { getDifferences } from '../utils/Difference';

const MIN_STATE_UPDATE_MS = 50;
const ERROR_INVALID_STATE_PATH = "The path is not a valid state path ";
const ERROR_PATH_NOT_FOUND = "The path was not found and initializeIfMissing=false";

type DisposeListenersFn = () => void;

/**
 * Generates the createStateHook function wired to the given store and using the root type R
 * @param store
 * @returns
 */
export const createStateHookFactory = <R>(store: Store<R> = createStore()) => {
    // Ensure type safety for the bind operation
    const createExtStateHook = <S extends { [key: string | symbol]: any } | any[]>(
        path: string,
        initialState?: S,
        listenToPaths?: string | string[],
        initializeIfMissing?: boolean
    ): S & ProxyObject => createStateHook<R, S>(store, path, initialState, listenToPaths, initializeIfMissing);

    return {
        createStateHook: createExtStateHook,
        store
    };
};

/**
 * Creates the state hook for path, using initialState to ensure the state in properly populated, wires up state change listeners and creates the mini React state
 * @param store
 * @param path
 * @param initialState
 * @returns
 */
export const createStateHook = <R, S extends object>(
    store: Store<R>,
    path: string,
    initialState?: S,
    listenToPaths: string | string[] = [path, `${path}.$every`],
    initializeIfMissing: boolean = false
): S & ProxyObject => {
    ///LOGGING
    report("hook-init", "Initializing hook for %s", [path]);
    ///END LOGGING

    const lastUpdate = useRef(0);
    const needsStateUpdate = useRef<any>(false);
    const isUpdating = useRef(false);
    const isDisposed = useRef(false);
    //store the dispose listeners function in case we need to switch out the listeners
    const disposeListenersRef = useRef<DisposeListenersFn | null>(null);
    
    // Wire up listeners for the specified path and its children
    useEffect(() => {
        initializeListeners();
        return () => {
            //use the dynamic dispose method since React will reuse state
            // this will be the dispose method closure with the last context
            if (disposeListenersRef.current)
                disposeListenersRef.current();
        };
    }, []);

    //React will reuse the state so we have to check to see if it's changed
    // if it's changed then we need to dispose of the last hook and re-initialize
    const storeState = getStoreState();
    let [state, setState] = useState<S & ProxyObject>(storeState);
    if (storeState.__path !== state.__path) {
        if (disposeListenersRef.current) {
            ///LOGGING
            report("hook-init", "Reusing hook");
            ///END LOGGING

            disposeListenersRef.current();
            initializeListeners();
            setState(storeState);
            return storeState;
        }
    }

    /**
     * Adds starts listening for state updates and returns a function that will remove the listeners when called
     * @returns
     */
    function initializeListeners() {
        ///LOGGING
        report("hook-init", "Adding listeners for %s listening to %s", [path, listenToPaths]);
        ///END LOGGING

        //update relative paths in listenToPaths 
        listenToPaths = resolveRelativePath(path, listenToPaths);

        // Listen to changes at the path and all its children
        store.on(listenToPaths, listener);
        store.on(path, deleteListener);

        disposeListenersRef.current = disposeListeners;

        // Cleanup listeners on unmount
        return disposeListeners;
    }

    /**
     * Removes the listeners for this hook
     */
    function disposeListeners() {
        if (isDisposed.current) return;

        ///LOGGING
        report("hook-dispose", "Removing listeners for %s listening to %s", [path, listenToPaths]);
        ///END LOGGING
        store.off(listenToPaths, listener);
        store.off(path, deleteListener);

        disposeListenersRef.current = null;
        isDisposed.current = true;
    }

    /**
     * Uses the path to find the state in the store, if found, adds defaults, if not and initializeIfMissing=true, then creates the state, otherwise throws an error
     * @returns
     */
    function getStoreState(): S & ProxyObject {
        //make sure the pat his valid
        if (!validatePath(path)) {
            throw new Error(`${ERROR_INVALID_STATE_PATH} "${path}"`);
        }

        let storeState = store.get<S>(path);

        if (storeState === undefined) {
            ///LOGGING
            report("hook-init-extended", "Path not found %s", [path]);
            ///END LOGGING

            if (initializeIfMissing) {
                store.set<S>(
                    path,
                    initialState
                        ? deepDereference(initialState)
                        : {} as S
                );
                storeState = store.get<S>(path);
            }
        }
        //apply defaults if there is an initial state
        else if (initialState) {
            ///LOGGING
            report("hook-init-extended", "Path found %s", [path]);
            ///END LOGGING

            storeState.__applyIf!(initialState);
        }

        if (!storeState)
            throw new Error(`${ERROR_PATH_NOT_FOUND} "${path}"`);

        return storeState;
    }

    /**
     * Handles state change events, gets the new values and executes the setState with the new proxy
     * @param eventPath
     * @param value
     * @param oldValue
     * @returns
     */
    function listener(eventPath: string, value: any, oldValue: any, action: string) {
        if (isDisposed.current) return;

        //throttle React state updates 
        const runtime = performance.now() - lastUpdate.current;
        if (runtime < MIN_STATE_UPDATE_MS || isUpdating.current) {
            ///LOGGING
            report("hook-update-delay", "Hook recieved an update for %s to %s", [eventPath, action]);
            ///END LOGGING

            if (needsStateUpdate.current) {
                //use this ref to hold the final oldValue
                needsStateUpdate.current = oldValue;
                return;
            }
            //use this ref to hold the final oldValue
            needsStateUpdate.current = oldValue;

            //delay recalling the listener with the original value and final old value
            const delta = MIN_STATE_UPDATE_MS - runtime;
            setTimeout(() => {
                needsStateUpdate.current = false;
                listener(eventPath, value, needsStateUpdate.current, action);
            }, delta);
            return;
        }

        ///LOGGING
        report("hook-update", "Hook recieved an update for %s to %s", [eventPath, action]);
        report("hook-update-diff", "Hook update diff for %s ", () => [eventPath, typeof value === "object" && value.__getDifferences(oldValue) || getDifferences(value, oldValue, eventPath)])
        ///END LOGGING

        // get a new proxy from the store, this should cause setState to rerender
        const updatedValue = store.get<S>(path);

        // Update React state when the store changes
        isUpdating.current = true;
        setState(updatedValue);
        isUpdating.current = false;

        lastUpdate.current = performance.now();
    };

    /**
     * Handles the delete of the root state
     * @param eventPath
     * @param value
     * @param oldValue
     * @param action
     */
    function deleteListener(eventPath: string, value: any, oldValue: any, action: string) {
        if (action === "delete" && !isDisposed.current) {
            ///LOGGING
            report("hook-dispose", "Root path deleted %s", [eventPath]);
            ///END LOGGING

            disposeListeners();
        }
    }

    return state;
}