#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { loadGitLabConfig, upsertIssueByTitle } from "./lib/gitlab-automation.mjs";

const args = parseArgs(process.argv.slice(2));

if (!args.input) {
  printUsage();
  process.exit(1);
}

const repoRoot = process.cwd();
const config = loadGitLabConfig(repoRoot);
const payload = JSON.parse(fs.readFileSync(path.resolve(repoRoot, args.input), "utf8"));
const projectPath = String(args.project || config.gitlabProject || "").trim();

if (!config.gitlabToken) {
  throw new Error("GITLAB_TOKEN is not configured");
}
if (!projectPath) {
  throw new Error("GitLab project path is not configured");
}
if (!payload.issue_title || !payload.issue_body) {
  throw new Error("payload must contain issue_title and issue_body");
}

const result = await upsertIssueByTitle(config, {
  projectPath,
  title: payload.issue_title,
  description: payload.issue_body,
  labels: payload.issue_labels || [],
  updateIfExists: args.updateIfExists,
  searchState: args.searchState || "opened"
});

const output = {
  action: result.action,
  issue_iid: result.issue.iid,
  web_url: result.issue.web_url,
  title: result.issue.title,
  labels: Array.isArray(result.issue.labels) ? result.issue.labels : payload.issue_labels || [],
  project_path: projectPath
};

if (args.output) {
  const outputPath = path.resolve(repoRoot, args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
} else {
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function parseArgs(argv) {
  const output = {
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
    "Usage:\n  node scripts/create-gitlab-issue-from-payload.mjs --input <payload.json> [--project <path>] [--update-if-exists] [--output <result.json>]\n",
  );
}
