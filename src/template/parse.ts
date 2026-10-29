import { TemplateCompileError, TemplateParseError } from '../errors.js';

const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/**
 * Wraps the template so several top-level elements form one XML document in the XHTML namespace.
 * It has no newline, so engine line numbers match the caller's string and only line 1 columns need correcting
 */
const WRAPPER_OPEN = `<root xmlns="${XHTML_NAMESPACE}">`;
const WRAPPER_CLOSE = '</root>';

/**
 * Templates are strict XML, so these rules trip up anyone used to HTML parsing
 */
export const PARSE_HINT = 'Templates are parsed as strict XHTML: '
    + 'escape < as &lt; and & as &amp; inside attribute values and text '
    + '(e.g. {{ $.a &lt; 3 &amp;&amp; $.b }}); '
    + 'self-close void elements (<input />, <br />, <img />); '
    + 'only the five XML entities exist (&lt; &gt; &amp; &quot; &apos;), so write &nbsp; as &#160;.';

//elements StateUI refuses in templates: scripts never run from templates, and styles go through the styles option
const FORBIDDEN_ELEMENTS: ReadonlySet<string> = new Set(['script', 'style']);

//an & must start a named entity or a decimal/hex character reference
const PATT_BARE_AMPERSAND = /&(?![A-Za-z_][\w.-]*;|#[0-9]+;|#x[0-9A-Fa-f]+;)/g;
//comments and CDATA sections may contain a bare &
const PATT_COMMENT_OR_CDATA = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g;
//engines report "error on line 3 at column 7" (libxml2, Chromium, happy-dom)
const PATT_LINE_COLUMN = /line\s+(\d+)\s+at\s+column\s+(\d+)/i;
const PATT_NEWLINE = /\r\n|\r|\n/;

/**
 * Returns the 1-based line of source, or "" when it doesn't exist
 * @param source
 * @param line
 */
const getSourceLine = (source: string, line: number) => {
    return source.split(PATT_NEWLINE)[line - 1] ?? '';
};

/**
 * Converts a 0-based offset in source to a 1-based line and column
 * @param source
 * @param offset
 */
const toLineColumn = (source: string, offset: number) => {
    const before = source.slice(0, offset).split(PATT_NEWLINE);
    return {
        line: before.length,
        column: before[before.length - 1].length + 1,
    };
};

/**
 * Throws a TemplateParseError for the first & that doesn't start an entity or character reference.
 * Some engines (happy-dom) accept a bare &, so this makes the rule hold everywhere and gives an exact position
 * @param source
 */
const assertNoBareAmpersand = (source: string) => {
    //blank out comments and CDATA with same-length filler so offsets stay put
    const scannable = source.replace(PATT_COMMENT_OR_CDATA, (section) => section.replace(/[^\r\n]/g, ' '));
    PATT_BARE_AMPERSAND.lastIndex = 0;
    const match = PATT_BARE_AMPERSAND.exec(scannable);
    if (!match) {
        return;
    }

    const { line, column } = toLineColumn(source, match.index);
    const excerpt = getSourceLine(source, line);
    throw new TemplateParseError(
        `Template parse error at line ${line}, column ${column}: unescaped "&"\n${excerpt}\n${PARSE_HINT}`,
        { line, column, excerpt, hint: PARSE_HINT }
    );
};

/**
 * Builds a TemplateParseError from a <parsererror> element, mapping the engine's position back to the caller's string
 * @param parserError
 * @param source
 */
const toParseError = (parserError: Element, source: string) => {
    const engineMessage = (parserError.textContent ?? '').trim();
    const match = engineMessage.match(PATT_LINE_COLUMN);

    let line: number | undefined;
    let column: number | undefined;
    if (match) {
        line = Number(match[1]);
        column = Number(match[2]);
        //the wrapper's opening tag sits in front of the caller's first line
        if (line === 1) {
            column = Math.max(1, column - WRAPPER_OPEN.length);
        }
    }

    const excerpt = getSourceLine(source, line ?? 1);
    const position = line !== undefined
        ? ` at line ${line}, column ${column}`
        : '';
    //keep only the engine's first error line; the rest is boilerplate ("Below is a rendering of the page...")
    const reason = engineMessage
        .replace(/^This page contains the following errors:\s*/i, '')
        .split(PATT_NEWLINE)[0];

    return new TemplateParseError(
        `Template parse error${position}: ${reason}\n${excerpt}\n${PARSE_HINT}`,
        { line, column, excerpt, hint: PARSE_HINT }
    );
};

/**
 * Returns the childNodes index path from root down to node
 * @param root
 * @param node
 */
const getNodePath = (root: Node, node: Node) => {
    const path: number[] = [];
    let current: Node = node;
    while (current !== root && current.parentNode) {
        path.unshift(Array.prototype.indexOf.call(current.parentNode.childNodes, current));
        current = current.parentNode;
    }
    return path;
};

/**
 * Throws a TemplateCompileError for the first script or style element at any depth
 * @param root
 */
const assertNoForbiddenElements = (root: Element) => {
    for (const element of Array.from(root.getElementsByTagName('*'))) {
        const name = element.localName.toLowerCase();
        if (FORBIDDEN_ELEMENTS.has(name)) {
            const reason = name === 'style'
                ? 'put component styles in the styles option instead'
                : 'templates cannot contain scripts';
            throw new TemplateCompileError(
                `<${element.localName}> is not allowed in a template: ${reason}`,
                { nodePath: getNodePath(root, element) }
            );
        }
    }
};

/**
 * Parses a template string as strict XHTML and returns its top-level elements.
 * The elements belong to an XML document; compile imports them into the HTML document, so never use innerHTML on them
 * @param source
 * @throws TemplateParseError when the source is not well-formed
 * @throws TemplateCompileError when the source contains a script or style element
 */
export const parseTemplate = (source: string): Element[] => {
    assertNoBareAmpersand(source);

    const doc = new DOMParser().parseFromString(
        WRAPPER_OPEN + source + WRAPPER_CLOSE,
        'application/xhtml+xml'
    );

    //engines put <parsererror> in different places and namespaces, so search by tag name across the document
    const parserError = doc.getElementsByTagName('parsererror')[0];
    if (parserError) {
        throw toParseError(parserError, source);
    }

    const root = doc.documentElement;
    assertNoForbiddenElements(root);

    return Array.from(root.children);
};
