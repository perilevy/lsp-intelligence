// --- Error types ---
export var LspErrorCode;
(function (LspErrorCode) {
    LspErrorCode["NOT_READY"] = "NOT_READY";
    LspErrorCode["TIMEOUT"] = "TIMEOUT";
    LspErrorCode["SYMBOL_NOT_FOUND"] = "SYMBOL_NOT_FOUND";
    LspErrorCode["FILE_NOT_FOUND"] = "FILE_NOT_FOUND";
    LspErrorCode["CAPABILITY_MISSING"] = "CAPABILITY_MISSING";
    LspErrorCode["SERVER_CRASHED"] = "SERVER_CRASHED";
    LspErrorCode["GIT_UNAVAILABLE"] = "GIT_UNAVAILABLE";
})(LspErrorCode || (LspErrorCode = {}));
export class LspError extends Error {
    code;
    suggestion;
    constructor(code, message, suggestion) {
        super(message);
        this.code = code;
        this.suggestion = suggestion;
        this.name = 'LspError';
    }
}
// --- Constants ---
export const SKIP_DIRS = new Set([
    'node_modules', 'dist', 'es', '.cache', '.git',
    '__pycache__', '.next', '.turbo', 'coverage',
]);
export const DEFAULT_TIMEOUTS = {
    primitive: 10_000,
    composite: 20_000,
    context: 30_000,
    live: 10_000,
};
//# sourceMappingURL=types.js.map