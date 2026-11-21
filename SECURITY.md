# Security

## Report a problem privately

Use GitHub's private vulnerability reporting. Open this repo's **Security** tab and click **Report a vulnerability**. Only the maintainers see the report.

Please do not open a public issue for a security problem.

Say what you found, how to make it happen, and which version you used (`npx journeysfirst --version`).

## In scope

- The `journeysfirst` package in `packages/core`: the readers and validators, the recorder, the Playwright fixture and reporter, the CLI, and the skills and templates it ships.
- The local servers: the review page (`journeysfirst review`) and the dev server (`journeysfirst dev-server`). By default they listen on 127.0.0.1 with no login, and answer only requests addressed to this machine.
- The publish protocol: the client (`journeysfirst/publish`) and the handler (`journeysfirst/publish-handler`).

Examples of problems to report: a secret value written to a run file, a publish token sent to a host other than the service or over plain http, a file outside the runs folder served by the review page, or a run that reads as `passed` when its evidence does not support it.

## A leak in a published run

A run folder holds screenshots and the whole video of each person's session, so it holds what was on screen during the run. It can also hold page addresses and values the run recorded. If a published run shows something it should not, report it to whoever runs the service it was published to. They hold the copy. This repo has no access to runs published to a service.

If the leak was caused by this package, for example a value marked secret that was written anyway, report that here too.
