/**
 * The keep/move/insert/remove plan for a keyed list update
 */
export interface KeyedPlan<T> {
    //per position of the new list: the existing item to reuse, or undefined to create one
    matches: Array<T | undefined>;
    //existing items whose key is gone
    removed: T[];
    //reused items that stay where they are; every other reused item moves, every undefined match is inserted
    stable: Set<T>;
}

/**
 * Returns the indexes (into sequence) of one longest strictly increasing subsequence
 * @param sequence
 */
const longestIncreasingSubsequence = (sequence: readonly number[]) => {
    const tails: number[] = [];
    const previous: number[] = new Array(sequence.length).fill(-1);
    sequence.forEach((value, index) => {
        let low = 0;
        let high = tails.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            if (sequence[tails[middle]] < value) {
                low = middle + 1;
            }
            else {
                high = middle;
            }
        }
        if (low > 0) {
            previous[index] = tails[low - 1];
        }
        tails[low] = index;
    });

    const result: number[] = [];
    for (let index = tails.length ? tails[tails.length - 1] : -1; index !== -1; index = previous[index]) {
        result.push(index);
    }
    return result.reverse();
};

/**
 * Plans a keyed list update. Items are matched by key (a Map, so SameValueZero); a key repeated in the new list
 * reuses the existing item once and creates new items for the rest. Reused items whose relative order survives (one
 * longest increasing run of their old positions) stay put, so removing one of n items moves nothing and moving the
 * last item to the front moves one
 * @param existing - items in their current DOM order
 * @param nextKeys - keys of the new list, in order
 * @param keyOf
 */
export const reconcileKeyed = <T>(existing: readonly T[], nextKeys: readonly unknown[], keyOf: (item: T) => unknown): KeyedPlan<T> => {
    const byKey = new Map<unknown, T>();
    const oldPosition = new Map<T, number>();
    existing.forEach((item, position) => {
        oldPosition.set(item, position);
        if (!byKey.has(keyOf(item))) {
            byKey.set(keyOf(item), item);
        }
    });

    const matches = nextKeys.map((key) => {
        const item = byKey.get(key);
        if (item !== undefined) {
            byKey.delete(key);
        }
        return item;
    });

    const reused = new Set(matches.filter((item): item is T => item !== undefined));
    const removed = existing.filter((item) => !reused.has(item));

    const reusedInOrder = matches.filter((item): item is T => item !== undefined);
    const stableIndexes = longestIncreasingSubsequence(reusedInOrder.map((item) => oldPosition.get(item)!));
    const stable = new Set(stableIndexes.map((index) => reusedInOrder[index]));

    return { matches, removed, stable };
};
