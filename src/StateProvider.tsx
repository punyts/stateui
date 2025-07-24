import { useContext, ReactNode } from 'react';
import { createStore, Store } from './Store';
import { createStateHookFactory } from './createStateHook';
import * as React from 'react';

interface StateProviderProps<R> {
    initialState?: R; // Optional initial state
    children: ReactNode; // React children
}

interface StateContextValue<R> {
    store: Store<R>;
    createStateHook: ReturnType<typeof createStateHookFactory<R>>['createStateHook'];
}

// Create a context for the state
const StateContext = React.createContext<StateContextValue<any> | null>(null);

/**
 * StateProvider component that creates the store and provides the createStateHook function to all components.
 * @param initialState Optional initial state for the store.
 * @param children React children.
 */
export const StateProvider = <R,>({ initialState, children }: StateProviderProps<R>) => {
    // Create the store and the createStateHook function
    const store = createStore<R>(initialState || ({} as R));
    const { createStateHook } = createStateHookFactory<R>(store);

    // Provide the store and createStateHook function to the context
    return (
        <StateContext.Provider value={{ store, createStateHook }}>
            {children}
        </StateContext.Provider>
    );
};

/**
 * Custom hook to access the createStateHook function and store from the context.
 * @returns The createStateHook function and store.
 */
export const useStateContext = <R,>() => {
    const context = useContext(StateContext);
    if (!context) {
        throw new Error('useStateContext must be used within a StateProvider');
    }
    return context as StateContextValue<R>;
};

/**
 * Custom hook to access the globally shared createStateHook function.
 * @returns The createStateHook function.
 */
export const useCreateStateHook = <R, S extends { [key: string | symbol]: any } | any[]>(path: string, initialState: S, listenToPaths?: string | string[], initializeIfMissing?: boolean) => {
    return useStateContext<R>().createStateHook<S>(path, initialState, listenToPaths, initializeIfMissing);
}

export const useStateStore = <R,>() => {
    return useStateContext<R>().store;
}