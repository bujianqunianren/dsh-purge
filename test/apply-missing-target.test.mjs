import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ALL_PATCHES, applyPatches, patchStatus } from "../lib/core.js";
import { removeTreeNoFollowSync } from "../lib/remove-tree.js";

// 一条真能打上的补丁（单宿主、目标文件在 fixture 里），用它的 applied
// 结果证明"前一条目标缺失"没有把后面的补丁连坐。
// [v2] 载体由退役的 #90（RESTORE_NATIVE_STEERING）换成保留的 #74
// （ASSEMBLE_BEFORE_PRESTEP，目标 dsh-agent-loop/lib/index.js）。
const APPLIES = ALL_PATCHES.find((p) => p.id === 74);
assert.ok(APPLIES, "补丁 74 必须存在于 ALL_PATCHES，否则下面全部断言失去意义");
// #74 的第一处锚点原文；把它写进 fixture 的 loop 文件即可被它打上。
const APPLIES_ANCHOR = APPLIES.replacements[0].pattern;
assert.ok(
  typeof APPLIES_ANCHOR === "string" && APPLIES_ANCHOR.length > 0,
  "#74 锚点应为字符串",
);

function fixture({ withHostFiles = false }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-apply-missing-"));
  const home = path.join(root, "home");
  const aiBase = path.join(root, "node_modules", "@deepseek-ai");
  fs.mkdirSync(path.join(home, "profiles", "desktop"), { recursive: true });
  fs.writeFileSync(path.join(home, "profiles", "desktop", "package.json"), "{}");
  fs.mkdirSync(aiBase, { recursive: true });
  const targets = {};
  if (withHostFiles) {
    targets.loop = path.join(aiBase, "dsh-agent-loop", "lib", "index.js");
    fs.mkdirSync(path.dirname(targets.loop), { recursive: true });
    fs.writeFileSync(targets.loop, APPLIES_ANCHOR + "\n");
  }
  return { root, home, aiBase, targets, close: () => removeTreeNoFollowSync(root) };
}

async function withFixture(options, fn) {
  const f = fixture(options);
  const prevHome = process.env.DSH_HOME;
  const prevSurface = process.env.DSH_SURFACE;
  // 指向 fixture：apply 前的 profile 快照写到临时 home，绝不碰真实 ~/.dsh。
  process.env.DSH_HOME = f.home;
  process.env.DSH_SURFACE = "desktop";
  try {
    return await fn(f);
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
    if (prevSurface === undefined) delete process.env.DSH_SURFACE;
    else process.env.DSH_SURFACE = prevSurface;
    f.close();
  }
}

/**
 * 取一条"目标文件在本 fixture 里全都不存在"的补丁，用 patchStatus 实证，
 * 而不是按 ALL_PATCHES 的顺序假定第一条就缺——#87/#88 这类补丁的目标恰好是
 * fixture 里建出来的 agent-loop，靠顺序撞运气会在补丁重排后误判。
 */
async function absentPatch(f) {
  const opts = { dshHome: f.home, surface: "desktop" };
  const status = await patchStatus(f.aiBase, ALL_PATCHES, opts);
  const found = ALL_PATCHES.find(
    (p) => p.id !== APPLIES.id && status[p.id] === "missing_file",
  );
  assert.ok(found, "本 fixture 里应至少有一条目标文件全缺的补丁");
  return found;
}

test("a patch whose target files are all absent is reported, not thrown", async () => {
  await withFixture({}, async (f) => {
    const absent = await absentPatch(f);
    const report = await applyPatches(f.aiBase, [absent]);
    assert.equal(report.length, 1);
    assert.equal(report[0].patch_id, absent.id);
    assert.equal(
      report[0].status,
      "missing_file",
      "目标文件全缺时记 missing_file，整次 apply 不能抛异常",
    );
    assert.ok(report[0].missing > 0);
  });
});

test("a missing target does not stop the patches that follow it", async () => {
  await withFixture({ withHostFiles: true }, async (f) => {
    const absent = await absentPatch(f);
    const report = await applyPatches(f.aiBase, [absent, APPLIES]);
    assert.equal(report.length, 2, "第二条补丁必须也被处理");
    assert.equal(report[0].patch_id, absent.id);
    assert.equal(report[0].status, "missing_file");
    const applied = report[1];
    assert.equal(applied.patch_id, APPLIES.id);
    assert.equal(applied.status, "applied", "后面的补丁不能被前一条的缺失连坐");
    assert.ok(
      fs.readFileSync(f.targets.loop, "utf8").includes("__dshPurgePrepareAssemble"),
      "补丁内容必须真的写进磁盘",
    );
  });
});

test("re-applying after a missing target stays idempotent", async () => {
  await withFixture({ withHostFiles: true }, async (f) => {
    const absent = await absentPatch(f);
    await applyPatches(f.aiBase, [absent, APPLIES]);
    const once = fs.readFileSync(f.targets.loop, "utf8");
    const report = await applyPatches(f.aiBase, [absent, APPLIES]);
    assert.equal(report[1].status, "already", "第二次应判 already，不重复写");
    assert.equal(fs.readFileSync(f.targets.loop, "utf8"), once);
  });
});
