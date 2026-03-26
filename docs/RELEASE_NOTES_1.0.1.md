# Release Notes 1.0.1

## Summary

1.0.1 is the closure-verification patch release after 1.0.0.
It focuses on making the shipped workbench verifiably usable end-to-end instead of only visually present.

## What Changed

- Replaced the old running shell layout with the new Slack / AI Studio inspired workspace shell.
- Fixed mixed-language issues across the dashboard, system page, project room, and OpenClaw workspace page.
- Added a shared UI label mapping layer to keep bilingual role, stage, task, and status labels consistent.
- Hardened local production startup scripts and host binding behavior.
- Added a new automated closure verification script:
  - `pnpm verify:closure`
  - `pnpm test:acceptance`

## Verified Closure Flows

The new closure verification covers real execution of:

- Auth status and protected API access
- Project preview and project creation
- Project message, emergency intervention, resume
- Stage submission, rejection, resubmission, approval advance
- Structured task status update
- Runtime config save and validation
- OpenClaw workspace, project detail, and project report
- OpenClaw task writeback and batch task writeback
- OpenClaw agent creation
- Agent instruction preview
- Agent governance settings save
- SOUL / SOP save
- Long-term memory write
- Single-agent message and batch message
- OpenClaw SLA endpoint

## Safety

`verify:closure` performs cleanup after execution:

- temporary auth sessions are removed
- temporary projects are deleted
- temporary test agents are removed
- temporary memory entries are deleted
- modified SOUL / SOP content is restored
- temporary OpenClaw task writebacks are rolled back

## Version Note

This release stays within the original product direction, so it is a patch release rather than a new major capability line.
