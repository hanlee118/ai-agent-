import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

test("ui preferences return defaults when file is missing", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "occ-ui-pref-default-"));
  const prefPath = path.join(tempDir, "ui-preferences.json");
  const previous = process.env.OCC_UI_PREFERENCES_PATH;

  try {
    process.env.OCC_UI_PREFERENCES_PATH = prefPath;
    const mod = await import(`./ui-preferences.js?test=${Date.now()}-default`);
    const snapshot = await mod.getUiPreferences();
    assert.equal(snapshot.source, "default");
    assert.equal(typeof snapshot.workspacePath, "string");
    assert.equal(snapshot.autoSync, true);
    assert.equal(snapshot.apiProtection, true);
    assert.equal(snapshot.usageAlertThresholdPercent, 80);
  } finally {
    if (previous === undefined) {
      delete process.env.OCC_UI_PREFERENCES_PATH;
    } else {
      process.env.OCC_UI_PREFERENCES_PATH = previous;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ui preferences persist and reload from file", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "occ-ui-pref-save-"));
  const prefPath = path.join(tempDir, "ui-preferences.json");
  const previous = process.env.OCC_UI_PREFERENCES_PATH;

  try {
    process.env.OCC_UI_PREFERENCES_PATH = prefPath;
    const mod = await import(`./ui-preferences.js?test=${Date.now()}-save`);
    const updated = await mod.updateUiPreferences({
      language: "en",
      workspacePath: "/tmp/occ-workspace",
      autoSync: false,
      apiProtection: false,
      autonomousMode: true,
      usageAlert: false,
      usageAlertThresholdPercent: 88
    });
    assert.equal(updated.source, "file");
    assert.equal(updated.language, "en");
    assert.equal(updated.workspacePath, "/tmp/occ-workspace");
    assert.equal(updated.autonomousMode, true);
    assert.equal(typeof updated.updatedAt, "string");

    const reloaded = await mod.getUiPreferences();
    assert.equal(reloaded.source, "file");
    assert.equal(reloaded.language, "en");
    assert.equal(reloaded.workspacePath, "/tmp/occ-workspace");
    assert.equal(reloaded.autoSync, false);
    assert.equal(reloaded.apiProtection, false);
    assert.equal(reloaded.autonomousMode, true);
    assert.equal(reloaded.usageAlert, false);
    assert.equal(reloaded.usageAlertThresholdPercent, 88);
  } finally {
    if (previous === undefined) {
      delete process.env.OCC_UI_PREFERENCES_PATH;
    } else {
      process.env.OCC_UI_PREFERENCES_PATH = previous;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});
