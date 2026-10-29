export const STATEUI_VERSION = "0.0.0";

export { StateUIError, TemplateParseError, TemplateCompileError } from "./errors.js";
export type { TemplateParseErrorDetails, TemplateCompileErrorDetails } from "./errors.js";
export { parseTemplate, PARSE_HINT } from "./template/parse.js";
