// dsh-go 手机本机引擎（DSH App）的宿主锚点回归。
// 只验证补丁文本匹配与产物可编译，不执行宿主、不读用户配置、不改权限。
// [v2] 原 #90（恢复原生插话）相关用例随补丁退役删除，保留 #74 的
// dsh-go recall 缝锚点回归。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { ALL_PATCHES } from "../lib/patches/index.mjs";
import { applyReplacementsToText } from "../lib/core/verify.mjs";
import { patchApplied } from "../lib/core/shared.mjs";

const prestep = ALL_PATCHES.find((x) => x.id === 74);
const loopFixture = JSON.parse(
  fs.readFileSync(
    new URL("./fixtures/agent-loop-022-native.json", import.meta.url),
    "utf8",
  ),
);

test("#74: dsh-go recall seam is claimed and yields compilable preStep", () => {
  const native = loopFixture.preStep;
  const gated = native.replace(
    "\t\tconst claimed = this.inbox.claim(target, position.turn);\n\t\tconst selection = this.model.current();",
    "\t\tconst claimed = this.inbox.claim(target, position.turn);\n" +
      "\t\tconst recall = await dshGoRecall.prepare(this.loopCtx, this, position, claimed, signal);\n" +
      "\t\tconst selection = this.model.current();",
  );
  assert.notEqual(gated, native, "fixture must actually contain the recall seam");
  const result = applyReplacementsToText(gated, prestep);
  assert.equal(result.changed, true);
  assert.ok(patchApplied(result.text, prestep));
  assert.doesNotThrow(() => new vm.Script(`({${result.text}})`));
  // 钩子必须落在 recall 之后、model.current() 之前，且只出现一次。
  const hook = result.text.indexOf("__dshPurgePrepareAssemble");
  assert.ok(hook > result.text.indexOf("dshGoRecall.prepare"));
  assert.ok(hook < result.text.indexOf("const selection = this.model.current();"));
  assert.equal(result.text.split("__dshPurgePrepareAssemble").length, 2);
  assert.equal(applyReplacementsToText(result.text, prestep).changed, false);
});

test("#74: hosts without the recall seam keep migrating unchanged", () => {
  const result = applyReplacementsToText(loopFixture.preStep, prestep);
  assert.equal(result.changed, true);
  assert.ok(patchApplied(result.text, prestep));
  assert.ok(!result.text.includes("dshGoRecall"));
  assert.doesNotThrow(() => new vm.Script(`({${result.text}})`));
});
