export declare const CAPTURE_LIMIT: number;
/**
 * Run a command with its streams connected normally, saving selected text.
 * @param {string[]} argv
 * @param {{out: string, mcp?: boolean, secrets?: string[], identity?: {login: string} | {key: string}, diagnostic?: string}} options
 */
export declare function captureCommand(argv: string[], { out, mcp, secrets, identity, diagnostic }: {
    out: string;
    mcp?: boolean;
    secrets?: string[];
    identity?: {
        login: string;
    } | {
        key: string;
    };
    diagnostic?: string;
}): Promise<any>;
/** @param {string[]} values */
export declare function forwardedSecrets(values: string[]): string[];
/** @param {string[]} secrets */
export declare function makeRedactor(secrets: string[]): (/** @type {string} */ text: string) => string;
