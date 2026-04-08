#!/usr/bin/env node

import { loadPlaybookFromFile, validatePlaybook } from "./lib/playbook-automation.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.input) {
  printUsage();
  process.exit(1);
}

const { path, playbook } = loadPlaybookFromFile(args.input);
const result = validatePlaybook(playbook);

const output = {
  ok: result.ok,
  input: path,
  meta: result.meta,
  warnings: result.warnings,
  errors: result.errors
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (!result.ok) {
  process.exit(1);
}

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if ((current === "--input" || current === "-i") && argv[index + 1]) {
      output.input = argv[index + 1];
      index += 1;
    }
  }
  return output;
}

function printUsage() {
  process.stderr.write(
    "Usage:\n  node scripts/validate-playbook.mjs --input <playbook.json>\n"
  );
}
