import { test } from "node:test";
import assert from "node:assert/strict";
import { PermissionPolicy } from "../src/permissions/policy.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import {
  parseStepStatus,
  looksLikeQuestion,
} from "../src/foreman.js";

const CWD = "/work/project";
const policy = new PermissionPolicy(DEFAULT_CONFIG.permissions, CWD);

test("allows routine bash commands", () => {
  assert.equal(
    policy.classify({ toolName: "Bash", input: { command: "npm test" } }).decision,
    "allow",
  );
  assert.equal(
    policy.classify({ toolName: "Bash", input: { command: "git add . && git commit -m wip" } }).decision,
    "allow",
  );
});

test("escalates risky bash commands", () => {
  assert.equal(
    policy.classify({ toolName: "Bash", input: { command: "rm -rf build" } }).decision,
    "escalate",
  );
  assert.equal(
    policy.classify({ toolName: "Bash", input: { command: "git push origin main" } }).decision,
    "escalate",
  );
  // risky segment hidden behind an allowed one
  assert.equal(
    policy.classify({ toolName: "Bash", input: { command: "npm test && sudo reboot" } }).decision,
    "escalate",
  );
});

test("allows unrecognized bash commands not in the escalate list", () => {
  // escalateBash is the safety net; anything not on it is presumed safe project tooling
  assert.equal(
    policy.classify({ toolName: "Bash", input: { command: "frobnicate --all" } }).decision,
    "allow",
  );
  assert.equal(
    policy.classify({ toolName: "Bash", input: { command: "echo hello && ls" } }).decision,
    "allow",
  );
});

test("allows file edits inside the worktree, escalates outside", () => {
  assert.equal(
    policy.classify({ toolName: "Edit", input: { file_path: "/work/project/src/a.ts" } }).decision,
    "allow",
  );
  assert.equal(
    policy.classify({ toolName: "Write", input: { file_path: "src/b.ts" } }).decision,
    "allow",
  );
  assert.equal(
    policy.classify({ toolName: "Write", input: { file_path: "/etc/passwd" } }).decision,
    "escalate",
  );
});

test("escalates network tools and unknown tools", () => {
  assert.equal(
    policy.classify({ toolName: "WebFetch", input: { url: "http://x" } }).decision,
    "escalate",
  );
  assert.equal(
    policy.classify({ toolName: "MysteryTool", input: {} }).decision,
    "escalate",
  );
});

test("parseStepStatus reads the marker line", () => {
  const done = parseStepStatus('blah blah\nSTEP_STATUS: done | summary="did x" next="do y"');
  assert.equal(done.kind, "done");
  assert.equal(done.summary, "did x");
  assert.equal(done.next, "do y");

  const blocked = parseStepStatus('STEP_STATUS: blocked | reason="missing creds"');
  assert.equal(blocked.kind, "blocked");
  assert.equal(blocked.reason, "missing creds");

  assert.equal(parseStepStatus("no marker here").kind, "unknown");
  assert.equal(parseStepStatus("STEP_STATUS: plan_complete").kind, "plan_complete");
});

test("parseStepStatus parses needs_input with question and choices", () => {
  const status = parseStepStatus(
    'STEP_STATUS: needs_input | question="Should I update tests?" choices="Yes|No|Skip for now"',
  );
  assert.equal(status.kind, "needs_input");
  assert.equal(status.question, "Should I update tests?");
  assert.deepEqual(status.choices, ["Yes", "No", "Skip for now"]);
});

test("parseStepStatus handles needs_input without choices", () => {
  const status = parseStepStatus(
    'STEP_STATUS: needs_input | question="Which approach do you prefer?"',
  );
  assert.equal(status.kind, "needs_input");
  assert.equal(status.question, "Which approach do you prefer?");
  assert.equal(status.choices, undefined);
});

test("looksLikeQuestion detects trailing questions", () => {
  assert.equal(looksLikeQuestion("I did the thing. Should I also update the docs?"), true);
  assert.equal(looksLikeQuestion("Which option do you prefer"), true);
  assert.equal(looksLikeQuestion("Implemented the feature and tests pass."), false);
});
