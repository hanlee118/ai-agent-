#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { generatePayloadFromFile } from "./generate-gitlab-codex-payload.mjs";
import { loadGitLabConfig, upsertIssueByTitle } from "./lib/gitlab-automation.mjs";

const args = parseArgs(process.argv.slice(2));

if (!args.input) {
  printUsage();
  process.exit(1);
}

const repoRoot = process.cwd();
const config = loadGitLabConfig(repoRoot);
const payload = generatePayloadFromFile(args.input);
const projectPath = String(args.project || config.gitlabProject || "").trim();

let issue = null;
let issueAction = null;
if (args.createIssue) {
  if (!config.gitlabToken) {
    throw new Error("GITLAB_TOKEN is not configured");
  }
  if (!projectPath) {
    throw new Error("GitLab project path is not configured");
  }
  const result = await upsertIssueByTitle(config, {
    projectPath,
    title: payload.issue_title,
    description: payload.issue_body,
    labels: payload.issue_labels || [],
    updateIfExists: args.updateIfExists,
    searchState: args.searchState || "opened"
  });
  issue = result.issue;
  issueAction = result.action;
}

const bundle = {
  task_type: payload.codex_prompt_sections?.task_type,
  issue: issue
    ? {
        action: issueAction,
        iid: issue.iid,
        web_url: issue.web_url,
        project_path: projectPath,
        title: issue.title
      }
    : null,
  payload
};

if (args.output) {
  const outputPath = path.resolve(repoRoot, args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`);
} else {
  process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
}

function parseArgs(argv) {
  const output = {
    createIssue: argv.includes("--create-issue"),
    updateIfExists: argv.includes("--update-if-exists")
  };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if ((current === "--input" || current === "-i") && argv[index + 1]) {
      output.input = argv[index + 1];
      index += 1;
      continue;
    }
    if ((current === "--output" || current === "-o") && argv[index + 1]) {
      output.output = argv[index + 1];
      index += 1;
      continue;
    }
    if (current === "--project" && argv[index + 1]) {
      output.project = argv[index + 1];
      index += 1;
      continue;
    }
    if (current === "--search-state" && argv[index + 1]) {
      output.searchState = argv[index + 1];
      index += 1;
    }
  }
  return output;
}

function printUsage() {
  process.stderr.write(
    "Usage:\n  node scripts/prepare-gitlab-codex-run.mjs --input <input.json> [--create-issue] [--update-if-exists] [--project <path>] [--output <bundle.json>]\n",
  );
}
