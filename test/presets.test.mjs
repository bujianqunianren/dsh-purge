// The bundled `unrestricted` preset is a skeleton: it must stay a valid agent
// composition and install idempotently. [v2.1.0] The patch anchor checks are
// gone — there are no host patches left to anchor against.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installPreset, presetStatus, bundledPresetDir, userPresetDir } from "../lib/presets.js";
import { readPresetDefinition } from "../lib/redteam/preset-composition.js";

const template = () => fs.readFileSync(path.join(bundledPresetDir(), "agent.cordis.yml"), "utf8");

test("the bundled preset is present and is a full composition", () => {
  const text = template();
  assert(text.length > 1000, "template should be a full composition, not a stub");
  assert(text.includes("- id: persona"), "persona row");
  assert(text.includes("@deepseek-ai/dsh-tool-bash"), "shell tool row");
  assert(text.includes("- id: tool-web"), "web tool row");
  assert(text.includes("fetch:"), "web tool row has a fetch config");
});

test("install is idempotent and never overwrites user edits without force", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-preset-"));
  try {
    assert.equal(presetStatus(home).installed, false);
    const first = installPreset({ home });
    assert.equal(first.action, "installed");
    const file = path.join(first.dir, "agent.cordis.yml");
    assert(fs.existsSync(file));
    // [v2.1.0] #24（preset fetch 打开）已随补丁表移除：模板直接落盘 fetch: true。
    const installed = fs.readFileSync(file, "utf8");
    assert(installed.includes("fetch:"), "web tool row present after install");

    fs.writeFileSync(file, "user edited\n");
    const second = installPreset({ home });
    assert.equal(second.action, "kept");
    assert.equal(fs.readFileSync(file, "utf8"), "user edited\n");

    const forced = installPreset({ home, force: true });
    assert.equal(forced.action, "updated");
    assert.equal(fs.readFileSync(file, "utf8"), installed);
    assert.equal(presetStatus(home).installed, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("the bundled preset parses into a registry definition", () => {
  const def = readPresetDefinition("unrestricted", bundledPresetDir());
  assert.equal(def.id, "unrestricted");
  assert.equal(def.name, "无限制模式");
  assert.equal(def.order, 20);
  assert(Array.isArray(def.plugins), "plugins rows");
  assert(def.plugins.length >= 12, `expected a full composition, got ${def.plugins.length}`);
  const ids = def.plugins.map((row) => row && row.id).filter(Boolean);
  assert(ids.includes("persona"), "persona row kept");
  assert(!ids.includes("redteam-tools"), "red team rows stripped");
});

test("installed unrestricted preset preserves native skill discovery", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-skill-roots-"));
  try {
    const { dir } = installPreset({ home });
    const def = readPresetDefinition("unrestricted", dir);
    const provider = def.plugins.find((row) => row.id === "skill-filesystem");
    assert(provider, "filesystem skill provider is registered");
    assert.equal(provider.config.includeDefaultRoots, true,
      "user-agents and project skills must remain discoverable after installation");
    assert.equal(provider.config.customSkillDirs, undefined,
      "the default DSH home root should not also be registered as a custom root");
    assert(def.plugins.some((row) => row.id === "tool-skill"), "skill loader remains available");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("legacy template markers and incomplete presets never authorize a reset", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-preset-managed-"));
  try {
    installPreset({ home });
    const file = path.join(userPresetDir(home), "agent.cordis.yml");
    fs.writeFileSync(file, "# managed-by: dsh-purge\nold template\n");
    const updated = installPreset({ home });
    assert.equal(updated.action, "kept");
    assert.match(fs.readFileSync(file, "utf8"), /old template/);
    fs.unlinkSync(file);
    assert.equal(installPreset({ home }).action, "kept");
    assert.equal(fs.existsSync(file), false);
    fs.writeFileSync(file, "# my own preset\n");
    assert.equal(installPreset({ home }).action, "kept");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
