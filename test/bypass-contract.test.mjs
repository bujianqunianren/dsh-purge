// [v2] 破甲契约重写：原"25 条闸门必须存在"契约随分类重组退役。
// 双向契约：
//   1) 拆审批 / 拆沙箱 / 拆护栏 / 摘牌类补丁（v1 的 25 门 + #18/#19）必须
//      **不存在**于补丁表——任何人（包括后续优化）把它们加回来，CI 直接红；
//   2) 33 条保留补丁（修复与便利条目）的 name+replacements 指纹锁定：
//      无声改动任何一条，CI 直接红；要动必须说明理由并更新指纹。
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ALL_PATCHES } from "../lib/core.js";

// v1 破甲闸门 + 上下文管理 + 自我纠错等退役 id：一条都不许回来。
const RETIRED_GATE_IDS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 25,
  29, 30, 31, 32, 33, 34, 35, 36, 37, 40, 43, 46, 47, 48, 49, 50, 51, 53, 59,
  60, 61, 62, 63, 64, 65, 69, 71, 73, 76, 80, 89, 90, 93, 94,
];

// v2 保留补丁指纹：修复与便利条目，改动前必须更新此表并说明理由。
const RETAINED_FINGERPRINTS = {
  70: "f9025f5742f1ae66",
  91: "83155c877fe9ee35",
  92: "fa120ef92980a34d",
  22: "ff9bdc9986472ca5",
  23: "023b133a0f4ca82a",
  24: "72fe2acc2cfcbda5",
  26: "9c17f401bad91397",
  28: "681755a2ca9e332e",
  38: "8dfcd4ce194d7dbd",
  39: "97bf89a9513c47c8",
  42: "6b2f698ed818eed7",
  45: "41e2b2808a2d8c0c",
  52: "822df85e08567534",
  54: "ef96233a383fd647",
  55: "a55a1c0da3a71c67",
  74: "bc41b88d436f2e05",
  66: "a97a223234457fee",
  83: "a218fbb65d016ea0",
  84: "b02de14e824ca609",
  67: "1cb9cbbaf23fb2d8",
  68: "2590e742617f1242",
  72: "1dd090df0b8ac9fa",
  56: "cc632c52e38c4b94",
  77: "98bff43e714d7696",
  75: "5a5f781b215bbe2d",
  57: "84ab0f43e62f06ad",
  58: "6f1f58df5f66e46a",
  78: "92fb726698311697",
  82: "858b9f2d3cf80043",
  87: "d574b668971681ff",
  88: "32dec594d819e66c",
  95: "39e55a2036311a4b",
  96: "66488cda9bf86c4b",
};

function fingerprint(patch) {
  const shape = JSON.stringify({
    name: patch.name,
    replacements: (patch.replacements || []).map((r) => ({
      p: String(r.pattern).slice(0, 400),
      r: String(r.replace).slice(0, 400),
    })),
  });
  return crypto.createHash("sha256").update(shape).digest("hex").slice(0, 16);
}

test("retired bypass gates must not come back", () => {
  const byId = new Map(ALL_PATCHES.map((p) => [p.id, p]));
  const problems = [];
  for (const id of RETIRED_GATE_IDS) {
    if (byId.has(id)) problems.push(`#${id} returned to the patch table`);
  }
  assert.deepEqual(problems, [], problems.join("; "));
  assert.equal(ALL_PATCHES.length, 33, "v2 keeps exactly the 33 retained patches");
});

test("retained patches exist with unchanged semantics", () => {
  const byId = new Map(ALL_PATCHES.map((p) => [p.id, p]));
  const problems = [];
  for (const [id, expected] of Object.entries(RETAINED_FINGERPRINTS)) {
    const patch = byId.get(Number(id));
    if (!patch) {
      problems.push(`#${id} missing`);
      continue;
    }
    const actual = fingerprint(patch);
    if (actual !== expected) problems.push(`#${id} ${patch.name} changed (${expected} -> ${actual})`);
  }
  assert.deepEqual(problems, [], problems.join("; "));
});
