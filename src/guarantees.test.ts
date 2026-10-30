import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

/*
 * Source-level enforcement of StateUI's design guarantees:
 * - bindings, styles and scopes never read layout and never defer work (writes are synchronous and write-only)
 * - nothing in src/ evaluates strings as code or writes raw HTML
 * Comments, string literals and regex literals are blanked before matching. A line comment
 * "// stateui-allow: <token> -- <reason>" on the line before a match permits that token there; an allow without a
 * reason, or one with no match on the next line, fails the test
 */

interface Rule {
    family: string;
    pattern: RegExp;
}

interface Violation {
    file: string;
    line: number;
    family: string;
    token: string;
}

const LAYOUT_RULE: Rule = {
    family: 'layout read',
    pattern: /offsetWidth|offsetHeight|offsetTop|offsetLeft|offsetParent|clientWidth|clientHeight|clientTop|clientLeft|scrollWidth|scrollHeight|scrollTop|scrollLeft|getBoundingClientRect|getClientRects|getComputedStyle|innerText|scrollIntoView|focus\(/g,
};
const ASYNC_RULE: Rule = {
    family: 'deferred work',
    pattern: /setTimeout|setInterval|requestAnimationFrame|requestIdleCallback|queueMicrotask|\bawait\b|\basync\b|\bPromise\b|MutationObserver|ResizeObserver|IntersectionObserver/g,
};
const CODE_RULE: Rule = {
    family: 'code or html from strings',
    pattern: /\beval\(|new Function\(|\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write/g,
};

//directories (under src/) held to the layout and async rules; every directory is held to the code rule
const SYNC_DIRECTORIES = Object.freeze(['binding', 'style', 'scope']);
const PATT_ALLOW = /^\s*\/\/\s*stateui-allow:\s*(\S+)\s*(?:--\s*(.*\S))?\s*$/;
const PATT_TEST_FILE = /\.test\.ts$/;
//a "/" after one of these starts a regex literal rather than a division
const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '']);

/**
 * Replaces comments, string literals and regex literals with spaces, keeping newlines so line numbers survive
 * @param source
 */
const blankNonCode = (source: string) => {
    const out = source.split('');
    const blank = (from: number, to: number) => {
        for (let i = from; i < to; i++) {
            if (out[i] !== '\n') {
                out[i] = ' ';
            }
        }
    };

    let i = 0;
    let previous = '';
    while (i < source.length) {
        const char = source[i];
        const next = source[i + 1];

        if (char === '/' && next === '/') {
            const end = source.indexOf('\n', i);
            const stop = end === -1 ? source.length : end;
            blank(i, stop);
            i = stop;
            continue;
        }
        if (char === '/' && next === '*') {
            const end = source.indexOf('*/', i + 2);
            const stop = end === -1 ? source.length : end + 2;
            blank(i, stop);
            i = stop;
            continue;
        }
        if (char === "'" || char === '"' || char === '`' || (char === '/' && REGEX_PRECEDERS.has(previous))) {
            const close = char;
            let j = i + 1;
            let inClass = false;
            while (j < source.length) {
                const c = source[j];
                if (c === '\\') {
                    j += 2;
                    continue;
                }
                //single-quoted, double-quoted and regex literals end at a newline at the latest
                if (c === '\n' && close !== '`') {
                    break;
                }
                if (close === '/' && c === '[') {
                    inClass = true;
                }
                else if (close === '/' && c === ']') {
                    inClass = false;
                }
                else if (c === close && !inClass) {
                    break;
                }
                j++;
            }
            blank(i, Math.min(j + 1, source.length));
            i = j + 1;
            previous = 'x';
            continue;
        }
        if (!/\s/.test(char)) {
            previous = char;
        }
        i++;
    }
    return out.join('');
};

/**
 * Scans one source text against the rules, applying stateui-allow comments
 * @param source
 * @param rules
 * @param file
 */
const scanSource = (source: string, rules: readonly Rule[], file = '<fixture>') => {
    const violations: Violation[] = [];
    const problems: string[] = [];
    const originalLines = source.split('\n');
    const codeLines = blankNonCode(source).split('\n');

    //token allowed on a line (1-based) -> whether it was used
    const allows = new Map<number, { token: string; used: boolean; line: number }>();
    originalLines.forEach((text, index) => {
        const match = PATT_ALLOW.exec(text);
        if (!match) {
            return;
        }
        if (!match[2]) {
            problems.push(`${file}:${index + 1} stateui-allow for "${match[1]}" has no reason ("-- <reason>")`);
        }
        allows.set(index + 2, { token: match[1], used: false, line: index + 1 });
    });

    codeLines.forEach((text, index) => {
        const lineNumber = index + 1;
        for (const rule of rules) {
            rule.pattern.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = rule.pattern.exec(text)) !== null) {
                const allow = allows.get(lineNumber);
                if (allow && match[0].includes(allow.token.replace(/\($/, ''))) {
                    allow.used = true;
                    continue;
                }
                violations.push({ file, line: lineNumber, family: rule.family, token: match[0] });
            }
        }
    });

    for (const allow of allows.values()) {
        if (!allow.used) {
            problems.push(`${file}:${allow.line} stateui-allow for "${allow.token}" does not precede a match`);
        }
    }
    return { violations, problems };
};

/**
 * Lists the non-test .ts files under a directory, recursively; a missing directory has none
 * @param directory
 */
const listSourceFiles = (directory: string): string[] => {
    if (!existsSync(directory)) {
        return [];
    }
    return readdirSync(directory).flatMap((name) => {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) {
            return listSourceFiles(path);
        }
        return name.endsWith('.ts') && !PATT_TEST_FILE.test(name) ? [path] : [];
    });
};

/**
 * Scans a src/ tree: the code rule everywhere, the layout and async rules in the synchronous directories
 * @param srcRoot
 */
const scanTree = (srcRoot: string) => {
    const syncRoots = SYNC_DIRECTORIES.map((name) => join(srcRoot, name));
    const results = listSourceFiles(srcRoot).map((path) => {
        const isSync = syncRoots.some((root) => path.startsWith(root));
        const rules = isSync ? [LAYOUT_RULE, ASYNC_RULE, CODE_RULE] : [CODE_RULE];
        return scanSource(readFileSync(path, 'utf8'), rules, relative(srcRoot, path).replace(/\\/g, '/'));
    });
    return {
        violations: results.flatMap((result) => result.violations),
        problems: results.flatMap((result) => result.problems),
    };
};

const format = (violations: readonly Violation[]) => violations.map((v) => `${v.file}:${v.line} ${v.family}: ${v.token}`);

describe('StateUI source guarantees', () => {
    it('should find no layout reads, deferred work, code-from-strings or raw HTML writes in src/', () => {
        // Arrange: vitest runs from the package root (import.meta.url isn't a file: URL under happy-dom)
        const srcRoot = join(process.cwd(), 'src');
        expect(existsSync(join(srcRoot, 'binding'))).toBe(true);

        // Act
        const { violations, problems } = scanTree(srcRoot);

        // Assert
        expect(format(violations)).toEqual([]);
        expect(problems).toEqual([]);
    });

    describe('scanner self-test', () => {
        const all = [LAYOUT_RULE, ASYNC_RULE, CODE_RULE];

        it('should flag one fixture per rule family', () => {
            // Arrange
            const fixtures: ReadonlyArray<readonly [string, string]> = [
                ['layout read', 'const w = el.offsetWidth;\nel.focus();'],
                ['deferred work', 'setTimeout(() => apply(), 0);'],
                ['code or html from strings', 'el.innerHTML = html;'],
            ];

            for (const [family, source] of fixtures) {
                // Act
                const { violations } = scanSource(source, all);

                // Assert
                expect(violations.length).toBeGreaterThan(0);
                expect(violations.every((v) => v.family === family)).toBe(true);
            }
        });

        it('should pass a clean fixture and ignore banned words in comments, strings and regex literals', () => {
            // Arrange
            const source = [
                '// never call setTimeout or read offsetWidth here',
                "const label = 'innerHTML and eval( are only words';",
                'const pattern = /setTimeout|"quoted"/g;',
                '/* async await Promise */',
                'node.textContent = String(value);',
            ].join('\n');

            // Act / Assert
            expect(scanSource(source, all)).toEqual({ violations: [], problems: [] });
        });

        it('should honour an allow comment with a reason and fail one without a reason or without a match', () => {
            // Arrange
            const allowed = '// stateui-allow: getComputedStyle -- reading a custom property the browser resolved\nconst v = getComputedStyle(el);';
            const noReason = '// stateui-allow: getComputedStyle\nconst v = getComputedStyle(el);';
            const dead = '// stateui-allow: setTimeout -- leftover\nconst v = 1;';

            // Act / Assert
            expect(scanSource(allowed, all)).toEqual({ violations: [], problems: [] });
            expect(scanSource(noReason, all).problems).toHaveLength(1);
            expect(scanSource(dead, all).problems).toHaveLength(1);
        });

        it('should pass on missing or empty directories, skip test files and fail on a new banned file', () => {
            // Arrange
            const root = mkdtempSync(join(tmpdir(), 'stateui-guarantees-'));
            try {
                mkdirSync(join(root, 'style'));
                expect(scanTree(root)).toEqual({ violations: [], problems: [] });
                mkdirSync(join(root, 'binding'));
                writeFileSync(join(root, 'binding', 'ok.test.ts'), 'setTimeout(() => {}, 0);');
                writeFileSync(join(root, 'component.ts'), 'requestAnimationFrame(tick);');
                expect(scanTree(root).violations).toEqual([]);

                // Act
                writeFileSync(join(root, 'binding', 'bad.ts'), 'const h = el.clientHeight;\nel.outerHTML = x;');
                const { violations } = scanTree(root);

                // Assert
                expect(format(violations)).toEqual([
                    'binding/bad.ts:1 layout read: clientHeight',
                    'binding/bad.ts:2 code or html from strings: .outerHTML',
                ]);
            }
            finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });
});
