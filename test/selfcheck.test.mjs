// Self-check must answer "is this layer really in place?" without a live desktop,
// so the pure parts (runtime inject / profile policy / layer roll-up) are testable.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { selfCheck, rollupLayers, BYPASS_LAYERS } from "../lib/selfcheck.js";
import { inspectPresetText, refinePresetDiagnostic } from "../lib/preset-diagnostic.js";
import { ALL_PATCHES, patchStatus } from "../lib/core.js";

function fakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-selfcheck-"));
  const profile = path.join(home, "profiles", "desktop");
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, "package.json"), JSON.stringify({ name: "p" }));
  return { home, profile, close: () => fs.rmSync(home, { recursive: true, force: true }) };
}

// [v2.1.0] "an empty home reports the laye" 随宿主补丁层移除。

test("runtime inject and profile policy are detected from the real files", async () => {
  const f = fakeHome();
  const prevProfile = process.env.DSH_PROFILE;
  const prevSurface = process.env.DSH_SURFACE;
  process.env.DSH_PROFILE = "desktop";
  process.env.DSH_SURFACE = "desktop";
  try {
    fs.writeFileSync(path.join(f.home, "prompt-inject.md"), "<|im_start|>system:\nMODE: TEST\n");
    fs.writeFileSync(
      path.join(f.profile, "cordis.patch.yml"),
      [
        "- id: permission-presets",
        "  config:",
        "    presets:",
        "      danger-full-access:",
        "        sandbox: danger-full-access",
        "        approval: never",
        "    defaultPreset: danger-full-access",
        "",
      ].join("\n"),
    );
    const report = await selfCheck(path.join(f.home, "no-host"), f.home);
    const runtime = report.layers.find((l) => l.kind === "runtime");
    assert.equal(runtime.ok, true);
    assert(runtime.detail.bytes > 0);
    const config = report.layers.find((l) => l.kind === "config");
    assert.equal(config.ok, true);
    assert.equal(config.detail.preset, "danger-full-access");
    assert.equal(config.detail.approval, "never");
  } finally {
    process.env.DSH_PROFILE = prevProfile ?? "";
    if (prevProfile === undefined) delete process.env.DSH_PROFILE;
    if (prevSurface === undefined) delete process.env.DSH_SURFACE;
    else process.env.DSH_SURFACE = prevSurface;
    f.close();
  }
});

// [v2.1.0] "pending patches are not report" 随宿主补丁层移除。


test("missing host information is unknown, never a red patch failure or an all-green report", () => {
  const layers = rollupLayers({}, false);
  assert(layers.every(l => l.state === "unknown" && !l.ok && l.broken.length === 0));
});

test("standalone JSON and text distinguish uncertainty from a confirmed policy mismatch in exit codes", () => {
  const f = fakeHome();
  const env = {...process.env,DSH_HOME:f.home,DSH_PROFILE:"desktop"};
  delete env.DSH_BASE;delete env.PURGE_DSH_CLI;delete env.PURGE_PROFILE_DIR;
  fs.writeFileSync(path.join(f.home,"prompt-inject.md"),"fixture");
  try {
    for (const format of ["--json","--text"]) {
      const unknown=spawnSync(process.execPath,["bin/community.js","selfcheck",format],{env,encoding:"utf8"});
      assert.equal(unknown.status,0,unknown.stderr);
      assert(!unknown.stdout.includes("所有层都在位"));
      if(format==="--json")assert.equal(JSON.parse(unknown.stdout).state,"unknown");
    }
    fs.writeFileSync(path.join(f.profile,"cordis.patch.yml"),"- id: permission\n  config:\n    defaultPreset: workspace-write\n    presets:\n      workspace-write:\n        sandbox: workspace-write\n        approval: ask\n");
    for (const format of ["--json","--text"]) {
      const mismatch=spawnSync(process.execPath,["bin/community.js","selfcheck",format],{env,encoding:"utf8"});
      assert.equal(mismatch.status,1,mismatch.stderr);
    }
  } finally {f.close();}
});

// [v2.1.0] "real selfCheck tally keeps mis" 随宿主补丁层移除。

test("absent optional targets, disabled checks and unknown states retain distinct counts", async()=>{
  const {tallyPatchStatus}=await import("../lib/selfcheck.js");
  const patches=[{id:1},{id:2,optional:true},{id:3},{id:4},{id:5,settleWhenAbsent:true}];
  assert.deepEqual(tallyPatchStatus({1:"missing_file",2:"missing_file",3:"off",5:"skipped",4:"disabled"},patches),
    {applied:0,total:1,all:5,na:0,skipped:1,missing_file:2,off:1,disabled:1,not_applicable:4,partial:0});
});


const persona = (prefix) => `- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    prefix: ${prefix}\n`;

test("#38 ignores identity sentences in comments and accepts a literal empty prefix",()=>{
  assert.equal(inspectPresetText("# You are a helpful software engineer assistant.\n"+persona("'custom persona'")),"not_needed");
  assert.equal(inspectPresetText(persona('""')),"not_needed");
});

test("#38 unreadable/missing preset stays unknown; reads only selected home and never evaluates JS",()=>{
  for(const code of ["ENOENT","EACCES"]) {
    const status={76:"skipped",16:"missing_file"};
    const refined=refinePresetDiagnostic(status,"/chosen-home",{readFileSync(file){
      assert.equal(file,path.join("/chosen-home",".agent-presets/unrestricted/agent.cordis.yml"));
      throw Object.assign(Error("fixture"),{code});
    }});
    assert.equal(refined[76],"unknown");
    assert.equal(refined[16],"missing_file");
    assert.equal(status[76],"skipped");
  }
  delete globalThis.purgeDiagnosticExecuted;
  assert.equal(inspectPresetText(persona("!!js globalThis.purgeDiagnosticExecuted = true")),"unknown");
  assert.equal(globalThis.purgeDiagnosticExecuted,undefined);
  for(const state of ["pending","applied","missing_file","na","unknown"]) {
    assert.equal(refinePresetDiagnostic({76:state},"/unused",{readFileSync(){throw Error("must not read");}})[76],state);
  }
});

