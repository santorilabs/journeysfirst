export declare const CAPTURE_LIMIT: number;
/**
 * Run a command with its streams connected normally, saving selected text.
 * @param {string[]} argv
 * @param {{out: string, mcp?: boolean, secrets?: string[]}} options
 */
export declare function captureCommand(argv: string[], { out, mcp, secrets }: {
    out: string;
    mcp?: boolean;
    secrets?: string[];
}): Promise<any>;
