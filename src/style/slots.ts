import { report } from '@punyts/core';

/**
 * Where generated rules go: one slot per top-level dynamic rule or @each group, each holding a list of rule texts in
 * order. A null text holds a position without a rule (a skipped rule)
 */
export interface RuleSlots {
    set(index: number, texts: ReadonlyArray<string | null>): void;
}

interface SlotEntry {
    text: string | null;
    inserted: boolean;
}

/**
 * Applies the slots to a CSSStyleSheet. Setting a slot compares its texts position by position: an unchanged text
 * is left alone, a changed one is replaced with deleteRule + insertRule at its index, extra old ones are deleted.
 * Each insert runs in its own try/catch: an invalid rule is reported (once, until its text changes) and its position
 * stays empty; other rules are untouched
 * @param sheet
 * @param count - the number of slots
 */
export const sheetSlots = (sheet: CSSStyleSheet, count: number): RuleSlots => {
    const slots: SlotEntry[][] = Array.from({ length: count }, () => []);
    const insertedIn = (entries: SlotEntry[], end = entries.length) => entries.slice(0, end).filter((entry) => entry.inserted).length;

    return {
        set: (index, texts) => {
            const current = slots[index];
            const base = slots.slice(0, index).reduce((total, entries) => total + insertedIn(entries), 0);

            while (current.length > texts.length) {
                const removed = current.pop()!;
                if (removed.inserted) {
                    sheet.deleteRule(base + insertedIn(current));
                }
            }
            texts.forEach((text, position) => {
                const old = current[position];
                if (old && old.text === text) {
                    return;
                }
                const at = base + insertedIn(current, position);
                if (old?.inserted) {
                    sheet.deleteRule(at);
                }
                const entry: SlotEntry = { text, inserted: false };
                current[position] = entry;
                if (text === null) {
                    return;
                }
                try {
                    sheet.insertRule(text, at);
                    entry.inserted = true;
                }
                catch (error) {
                    report.error(`Skipped an invalid dynamic style rule "${text}": ${error instanceof Error ? error.message : String(error)}`, { error });
                }
            });
        },
    };
};

/**
 * Applies the slots to a <style> element: through its sheet when it has one, else by rewriting its text
 * @param style
 * @param count
 */
export const styleSlots = (style: HTMLStyleElement, count: number): RuleSlots => {
    if (style.sheet) {
        return sheetSlots(style.sheet, count);
    }
    const slots: Array<ReadonlyArray<string | null>> = new Array(count).fill([]);
    return {
        set: (index, texts) => {
            slots[index] = texts;
            style.textContent = slots.flat().filter((text) => text !== null).join('');
        },
    };
};
