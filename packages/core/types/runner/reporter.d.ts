export default class JourneyReporter {
    outputDir: string;
    /** @type {string[]} */
    written: string[];
    /** One batch id per test in this invocation. @type {Map<string, string>} */
    batches: Map<string, string>;
    /** @param {{outputDir?: string}} [options] */
    constructor({ outputDir }?: {
        outputDir?: string;
    });
    /**
     * @param {import("@playwright/test/reporter").TestCase} test
     * @param {import("@playwright/test/reporter").TestResult} result
     */
    onTestEnd(test: import("@playwright/test/reporter").TestCase, result: import("@playwright/test/reporter").TestResult): void;
    /** @param {import("@playwright/test/reporter").TestCase} test */
    batch(test: import("@playwright/test/reporter").TestCase): string;
    onEnd(): void;
    printsToStdio(): boolean;
}
