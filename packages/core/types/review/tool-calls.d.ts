/** How many earlier runs the tool calls are averaged over, at most. */
export declare const TOOL_RUNS = 10;
export type ToolCall = {
    tool: string;
    at?: number;
    ms?: number;
    error?: true;
    says?: string;
    recovered?: boolean;
    reply?: number;
};
export type ToolCalls = {
    file: string;
    calls: ToolCall[];
    line: string;
    average: string[];
    proves: string[][];
};
/**
 * @typedef {{tool: string, at?: number, ms?: number, error?: true, says?: string, recovered?: boolean, reply?: number}} ToolCall
 *   at: ms from the proxy's start to the call. ms: how long the call waited. says: the start of an error reply.
 *   recovered: on an error, whether a later call of the same tool worked. reply: the transcript line of the reply.
 * @typedef {{file: string, calls: ToolCall[], line: string, average: string[], proves: string[][]}} ToolCalls one transcript:
 *   line: its counts in words. average: the same for earlier passed runs, empty with none.
 *   proves: for each call, the ids of the checks that cite its reply as proof.
 */
/**
 * The tool calls in each transcript an MCP proxy saved for a run, in order.
 * ms is missing when the reply never came, or when an older proxy saved the transcript.
 * @param {string} folder a run folder
 * @returns {Map<string, ToolCall[]>} by transcript file. A transcript with no tool call is left out.
 */
export declare function readToolCalls(folder: string): Map<string, ToolCall[]>;
/**
 * One line for a transcript's tool calls: how many, how many returned an error, the wait, and the slowest.
 * @param {ToolCall[]} calls
 */
export declare function toolCallLine(calls: ToolCall[]): string;
/**
 * A run's tool calls beside the average of earlier runs, with the range.
 * @param {ToolCall[]} calls this run, one transcript
 * @param {ToolCall[][]} earlier the same transcript in each earlier run
 * @returns {string[]} no line when there is no earlier run
 */
export declare function toolCallAverage(calls: ToolCall[], earlier: ToolCall[][]): string[];
/**
 * A run's tool calls, one entry for each transcript that has any.
 * @param {string} folder a run folder
 * @returns {ToolCalls[]}
 */
export declare function toolCalls(folder: string): ToolCalls[];
/**
 * The lines `journeysfirst measured` prints about a run's tool calls: a fact
 * for each call that returned an error, then each transcript's counts and calls.
 * @param {string} folder a run folder
 * @returns {string[]} empty for a run with no tool calls
 */
export declare function toolCallReport(folder: string): string[];
