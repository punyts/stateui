import React, { FC } from 'react';
import { render, screen, act, cleanup } from '@testing-library/react';
import { createStore } from './Store';
import { createStateHookFactory } from './createStateHook';

describe('createStateHook', () => {
    interface RootState {
        counter: {
            count: number;
        };
        user: {
            name: string;
            age: number;
            address?: {
                city: string;
                country: string;
            };
        };
    }

    const initialState: RootState = {
        counter: {
            count: 0,
        },
        user: {
            name: 'John Doe',
            age: 30,
        },
    };

    let store: ReturnType<typeof createStore>;
    let createStateHook: ReturnType<typeof createStateHookFactory>['createStateHook'];

    beforeEach(() => {
        store = createStore<RootState>(initialState); // Reset store
        createStateHook = createStateHookFactory(store).createStateHook;
    });

    afterEach(() => {
        cleanup(); // Clean up React components and DOM
    });

    const TestComponent: FC<{ path: string; initialState?: any, initializeIfMissing?: boolean }> = ({ path, initialState, initializeIfMissing }) => {
        const state = createStateHook(path, initialState, undefined, initializeIfMissing);

        return (
            <div>
                <pre data-testid="state">{JSON.stringify(state, null, 2)}</pre>
            </div>
        );
    };

    it('should initialize state with initialState if store state is undefined', () => {
        render(<TestComponent path="$.user.address" initialState={{ city: 'New York', country: 'USA' }} initializeIfMissing={true} />);

        const state = screen.getByTestId('state');

        expect(JSON.parse(state.textContent!)).toEqual({
            city: 'New York',
            country: 'USA',
        });

        expect(store.get('$.user.address')).toEqual({
            city: 'New York',
            country: 'USA',
        });
    });

    it('should initialize state with empty object if store state is undefined and no initial state is given', () => {
        render(<TestComponent path="$.user.address" initializeIfMissing={true} />);

        const state = screen.getByTestId('state');

        expect(JSON.parse(state.textContent!)).toEqual({});
        expect(store.get('$.user.address')).toEqual({});
    });

    it('should merge missing properties from initialState into store state: 1', () => {
        store.apply('$.user', {
            name: 'Jane Doe',
        });

        render(
            <TestComponent
                path="$.user"
                initialState={{
                    name: '',
                    age: 0,
                    address: {
                        city: '',
                        country: '',
                    },
                }}
            />
        );

        const state = screen.getByTestId('state');
        expect(JSON.parse(state.textContent!)).toEqual({
            name: 'Jane Doe',
            age: 30,
            address: {
                city: '',
                country: '',
            },
        });

        expect(store.get('$.user')).toEqual({
            name: 'Jane Doe',
            age: 30,
            address: {
                city: '',
                country: '',
            },
        });
    });

    it('should trigger React re-renders when the store state is updated', async () => {
        render(<TestComponent path="$.counter" initialState={{ count: 0 }} />);

        const state = screen.getByTestId('state');
        expect(JSON.parse(state.textContent!)).toEqual({ count: 0 });

        await act(async () => {
            store.set('$.counter.count', 1);
        });

        expect(JSON.parse(state.textContent!)).toEqual({ count: 1 });
    });

    it('should wire up listeners for the specified path and its children', async () => {
        render(<TestComponent path="$.user" initialState={{ name: '', age: 0 }} />);

        const state = screen.getByTestId('state');

        expect(JSON.parse(state.textContent!)).toEqual({
            name: 'John Doe',
            age: 30,
        });
        
        await act(async () => {
            store.set('$.user.name', 'Jane Doe');
        });

        expect(JSON.parse(state.textContent!)).toEqual({
            name: 'Jane Doe',
            age: 30,
        });
    });
});

describe('createStateHookFactory', () => {
    interface RootState {
        counter: {
            count: number;
        };
        user: {
            name: string;
            age: number;
            address?: {
                city: string;
                country: string;
            };
        };
    }

    const initialState: RootState = {
        counter: {
            count: 0,
        },
        user: {
            name: 'John Doe',
            age: 30,
        },
    };

    let store: ReturnType<typeof createStore>;
    type CreateStateHookFn = ReturnType<typeof createStateHookFactory>['createStateHook'];
    let createStateHook: CreateStateHookFn;

    beforeEach(() => {
        store = createStore<RootState>(initialState); // Reset store
    });

    afterEach(() => {
        cleanup(); // Clean up React components and DOM
    });

    const TestComponent: FC<{ path: string; createStateHook: CreateStateHookFn, initialState?: any, initializeIfMissing?: boolean }> = ({ path, createStateHook, initialState, initializeIfMissing }) => {
        const state = createStateHook(path, initialState, undefined, initializeIfMissing);

        return (
            <div>
                <pre data-testid="state">{JSON.stringify(state, null, 2)}</pre>
            </div>
        );
    };

    it('should create a default store if not given', () => {
        const { createStateHook, store } = createStateHookFactory();
        store.set("$", {
            counter: {
                count: 0,
            },
            user: {
                name: 'John Doe',
                age: 30,
            },
        });
        render(<TestComponent
            path="$.user.address"
            createStateHook={createStateHook}
            initializeIfMissing={true}
            initialState={{ city: 'New York', country: 'USA' }}
        />);

        const state = screen.getByTestId('state');

        expect(JSON.parse(state.textContent!)).toEqual({
            city: 'New York',
            country: 'USA',
        });

        expect(store.get('$.user.address')).toEqual({
            city: 'New York',
            country: 'USA',
        });
    });
});