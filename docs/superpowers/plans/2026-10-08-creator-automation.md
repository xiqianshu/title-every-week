# Creator Automation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. The user delegated execution and technical choices to the current assistant.

**Goal:** Deliver a Mac background program for sourced collection, personalized weekly drafts and publication review.

**Architecture:** A local Node service owns persistent data and serialized jobs. Scoped Playwright/Codex or fixed OpenCLI commands collect evidence; a separate Codex generation step consumes that evidence. The same pipeline serves manual UI requests and scheduled jobs.

**Tech Stack:** Node standard library, pinned Codex / Playwright MCP / OpenCLI, macOS launchd.

**Spec:** ../specs/2026-10-08-creator-automation.md

## Global Constraints

- Node >= 22; dependencies pinned as specified in the spec.
- Schedule and date windows use Asia/Shanghai.
- Metrics unavailable to the collector remain null; default zeros and inferred dates are not evidence.
- No fabricated personal experiences; no automatic posting; no remote Mac bridge in this version.
- Tests may simulate external process boundaries, but their results must not be reported as live platform validation.

## Review Focus

- Browser login or verification stops the affected source without retry storms.
- A sleeping Mac resumes one due job, not every missed job.
- Duplicate notes with different URL tokens preserve the usable original URL and metric history.
- Local website requests cannot modify configuration from an unrelated origin.
- A missing executable or interrupted generation preserves the last successful report.

### Task 1: Persistent evidence and configuration

**Files:** src/model.mjs, src/store.mjs, test/model.test.mjs
**Interfaces:** normalizeItem(raw, source, at), makeSources(config, posts), reviewWindows(posts, snapshots, now), Store(root).
- [ ] Write tests for missing metrics, duplicate note identity, URL restriction, review windows and atomic state preservation; run and observe failures.
- [ ] Implement model and persistent store; run node --test test/model.test.mjs and expect all tests to pass.

### Task 2: External providers and content contract

**Files:** src/runtime.mjs, src/providers.mjs, src/prompts.mjs, schemas/, test/providers.test.mjs
**Interfaces:** runProcess(command, args, options), Providers.collect(sources, config), Providers.generate(bundle, kind), validatePack(pack, bundle).
- [ ] Test arguments as data, timeout, structured outputs, request association and rejection of invented source IDs; observe failures.
- [ ] Implement scoped subprocess calls, both collectors and prompts; run provider tests and expect all to pass.

### Task 3: Serialized pipeline and schedule

**Files:** src/pipeline.mjs, src/schedule.mjs, test/pipeline.test.mjs
**Interfaces:** Workflow.run(kind), Workflow.tick(now), Workflow.status(), scheduleDue(config, state, now).
- [ ] Test partial platform failure, total failure, report persistence, cross-process lock, catch-up and 72h/7d review persistence; observe failures.
- [ ] Implement job flow and automatic task selection; run pipeline tests and expect all to pass.

### Task 4: Local browser UI and Mac installation

**Files:** src/server.mjs, src/cli.mjs, src/mac.mjs, public/, 安装.command, 打开工作台.command, 停用后台.command, test/server.test.mjs, test/mac.test.mjs
**Interfaces:** createServer(workflow), makeLaunchAgent(options), installMac(options).
- [ ] Test real HTTP settings, notes, reports and job requests, CSRF/path bounds and schedule plist escaping; observe failures.
- [ ] Implement the UI, CLI and install commands; run npm test and expect the full suite to pass.

### Task 5: Review, package and setup persistence

**Files:** README.md, docs/THIRD_PARTY.md, scripts/check.mjs, scripts/package.py.
- [ ] Verify actual pinned CLI help and command registry, run full tests and functional local HTTP checks.
- [ ] Request one fresh final review; resolve material findings with failing regression tests before fixes.
- [ ] Produce a Mac ZIP with executable command files and preserved data on reinstall; record checks and distinguish untested Mac/platform operations.
