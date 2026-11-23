// 1.7.18：权限补丁与上下文管理曾是两个组开关。
// [v2] 14 条 permissionOverride 补丁与 #18/#19 已随分类重组退役：
// 两个开关不再有作用对象，字段仅为兼容旧 tuning 文件而保留读写。
// 本文件断言退役语义 + tuning 读写的向后兼容。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ALL_PATCHES,
  patchEnabled,
} from "../lib/core.js";
import { TUNING_DEFAULTS, readTuning, writeTuning } from "../lib/tuning.js";
import { removeTreeNoFollowSync } from "../lib/remove-tree.js";

const patch = (id) => ALL_PATCHES.find((p) => p.id === id);

function home() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-gate-"));
  fs.mkdirSync(path.join(root, "dsh-purge"), { recursive: true });
  return { root, close: () => removeTreeNoFollowSync(root) };
}

test("v2：拆门类组开关不再有作用对象，字段仅为兼容保留", () => {
  assert.deepEqual(
    ALL_PATCHES.filter((p) => p.permissionOverride),
    [],
    "14 条权限改写补丁已在 v2 退役",
  );
  assert.equal(patch(18), undefined, "#18 已退役");
  assert.equal(patch(19), undefined, "#19 已退役");
  // 默认值保持原口径（读取旧配置不改变语义）。
  assert.equal(TUNING_DEFAULTS.permissionPatches, true);
  assert.equal(TUNING_DEFAULTS.contextManagement, false);
  // patchEnabled 对带 permissionOverride 的（不存在的）补丁声明仍按开关判定，
  // 对普通保留补丁恒放行——空对象集意味着开关实际无效果。
  assert.equal(patchEnabled({ id: 999, permissionOverride: true }, { extraPatches: [], permissionPatches: false }), false);
  assert.equal(patchEnabled({ id: 999, permissionOverride: true }, { extraPatches: [] }), true);
  assert.equal(patchEnabled(patch(22), { extraPatches: [], permissionPatches: false }), true, "保留补丁不受组开关影响");
  assert.equal(patchEnabled(patch(91), { extraPatches: [], contextManagement: true }), true, "保留补丁不受上下文开关影响");
});

test("readTuning 把旧的 extraPatches #18/#19 迁移成 contextManagement=true", () => {
  const h = home();
  try {
    fs.writeFileSync(
      path.join(h.root, "dsh-purge", "tuning.json"),
      JSON.stringify({ refusalRetry: true, extraPatches: [19] }),
    );
    const tuning = readTuning(h.root);
    assert.equal(tuning.contextManagement, true);
    assert.equal(tuning.permissionPatches, true, "缺字段按默认开");
    assert.deepEqual(tuning.extraPatches, [19], "清单本身不清空，CLI 仍可读");
  } finally {
    h.close();
  }
});

test("permissionPatches:false 写入后能读回，且不污染其它字段", () => {
  const h = home();
  try {
    writeTuning({ permissionPatches: false, contextManagement: true }, h.root);
    const tuning = readTuning(h.root);
    assert.equal(tuning.permissionPatches, false);
    assert.equal(tuning.contextManagement, true);
    assert.equal(tuning.boost, true);
    writeTuning({ permissionPatches: true }, h.root);
    const back = readTuning(h.root);
    assert.equal(back.permissionPatches, true);
    assert.equal(back.contextManagement, true, "没传的字段保持原值");
  } finally {
    h.close();
  }
});
