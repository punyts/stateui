/**
 * Escapes a string for use as a CSS identifier, following the CSSOM CSS.escape algorithm (own implementation, so it
 * never depends on the global): NUL becomes U+FFFD; control characters, a leading digit and a digit after a leading
 * "-" become hex escapes; a lone "-" is escaped; letters, digits, "-", "_" and non-ASCII are kept; anything else
 * gets a backslash
 * @param value
 */
export const escapeIdent = (value: string): string => {
    let result = '';
    const first = value.charCodeAt(0);
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        const char = value[index];
        if (code === 0) {
            result += '�';
        }
        else if ((code >= 0x01 && code <= 0x1f) || code === 0x7f
            || (index === 0 && code >= 0x30 && code <= 0x39)
            || (index === 1 && code >= 0x30 && code <= 0x39 && first === 0x2d)) {
            result += `\\${code.toString(16)} `;
        }
        else if (index === 0 && code === 0x2d && value.length === 1) {
            result += '\\-';
        }
        else if (code >= 0x80 || code === 0x2d || code === 0x5f || /[0-9A-Za-z]/.test(char)) {
            result += char;
        }
        else {
            result += `\\${char}`;
        }
    }
    return result;
};
