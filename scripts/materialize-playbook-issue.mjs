#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  loadPlaybookFromFile,
  materializePlaybookIssue,
  validatePlaybook
} from "./lib/playbook-automation.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.input || !args.issueId) {
  printUsage();
  process.exit(1);
}

const { playbook } = loadPlaybookFromFile(args.input);
const validation = validatePlaybook(playbook);
if (!validation.ok) {
  process.stderr.write(`${JSON.stringify(validation, null, 2)}\n`);
  process.exit(1);
}

const payload = materializePlaybookIssue(playbook, args.issueId);

if (args.output) {
  const outputPath = path.resolve(process.cwd(), args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
} else {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if ((current === "--input" || current === "-i") && argv[index + 1]) {
      output.input = argv[index + 1];
      index += 1;
      continue;
    }
    if (current === "--issue-id" && argv[index + 1]) {
      output.issueId = argv[index + 1];
      index += 1;
      continue;
    }
    if ((current === "--output" || current === "-o") && argv[index + 1]) {
      output.output = argv[index + 1];
      index += 1;
    }
  }
  return output;
}

function printUsage() {
  process.stderr.write(
    "Usage:\n  node scripts/materialize-playbook-issue.mjs --input <playbook.json> --issue-id <id> [--output <payload.json>]\n"
  );
}
