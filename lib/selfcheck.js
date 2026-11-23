// Purge self-check (v2.1.0): the host patch layer is gone.
// What remains are the runtime layers — the things that actually make the
// plugin work without ever touching the host installation directory.
//   runtime: prompt-inject.md reaches the model as a dsh-purge section.
//   config:  the profile's permission selection is reported for reference.
// The host kind is always "na" — there are no host patches to check.
import fs from "node:fs";
import path from "node:path";
import * as core from "./core.js";
import { compatibility } from "./community.js";
import { resolveProfile, diagnosticHost, hostSurface } from "./instance.js";
import { refinePresetDiagnostic } from "./preset-diagnostic.js";
import { patchNotApplicable as notApplicable, patchStateCategory, summarizePatchRows } from "./patch-state.mjs";
import { permissionState } from "./permission-state.js";

/** [v2.1.0] The host patch table is empty; BYPASS_LAYERS kept as a frozen [] for compat. */
export const BYPASS_LAYERS = Object.freeze([]);

function readProfileConfig(dshHome, options) {
  let file = "";
  try {
    const profile = resolveProfile(dshHome, options);
    file = path.join(profile.directory, "cordis.patch.yml");
    return { file, text: fs.readFileSync(file, "utf8"), profile };
  } catch (e) { return { file, text: "", error: e.message }; }
}

function configLayer(dshHome, options) {
  const { file, text, profile, error } = readProfileConfig(dshHome, options);
  return {
    ...permissionState(text, options?.ctx),
    file,
    profile: profile?.name || "",
    profile_source: profile?.source || "",
    ...(error ? { error, note: `无法读取当前 profile：${error}` } : {}),
  };
}

function runtimeLayer(dshHome) {
  const file = core.findOverrideFile(dshHome);
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { text = ""; }
  const bytes = Buffer.byteLength(text, "utf8");
  return {
    file,
    bytes,
    ok: bytes > 0,
    note: bytes > 0
      ? `注入文件 ${bytes} 字节，会作为 dsh-purge section 每步重贴（仅 unrestricted / redteam 预设）`
      : "注入文件为空：插件能加载，但没有内容可注入",
  };
}

export function tallyPatchStatus(status, patches = core.ALL_PATCHES) {
  const counts = summarizePatchRows(patches.map(patch => ({...patch, status:status[patch.id]})));
  const {applied, total, all, na, skipped, missing_file, off, disabled, not_applicable, partial} = counts;
  return {applied, total, all, na, skipped, missing_file, off, disabled, not_applicable, partial};
}

export function rollupLayers(status, hasHost, options = {}) {
  // [v2.1.0] 无宿主补丁层：恒返回空数组。保留导出形状兼容旧引用面。
  return [];
}

export function resolveHost(aiBase, options = {}) {
  return diagnosticHost({...options, aiBase, diskReader: options.reader});
}

export async function selfCheck(aiBase, dshHome = core.findDshHome(), options = {}) {
  const host = resolveHost(aiBase, options);
  const compat = compatibility(host);
  const services = options.coreModule || core;

  const runtime = runtimeLayer(dshHome);
  const runtimeLayers = [{
    title: "运行时提示词注入",
    why: "prompt-inject.md 作为 dsh-purge section 参与每一步 system prompt 组装（仅 unrestricted / redteam）",
    kind: "runtime",
    ids: [],
    ok: runtime.ok,
    state: runtime.ok ? "ok" : "broken",
    applied: runtime.ok ? 1 : 0,
    total: 1,
    pending: [],
    broken: runtime.ok ? [] : [{ id: "inject", status: "empty" }],
    detail: runtime,
  }];

  const config = configLayer(dshHome, options);
  const configLayers = [{
    title: "当前 profile 的权限选择",
    why: "宿主源码补丁已移除；这是纯参考信息，显示当前 profile 声明的权限组合",
    kind: "config",
    ids: [],
    ok: true,
    state: config.state === "broken" ? "broken" : config.state || "unknown",
    note: config.note,
    applied: 0,
    total: 1,
    pending: [],
    broken: config.state === "broken" ? [{ id: "preset", status: `${config.preset}/${config.approval}` }] : [],
    detail: config,
  }];

  const layers = [...runtimeLayers, ...configLayers];
  const byKind = (kind) => layers.filter((layer) => layer.kind === kind && layer.applicable !== false);
  const summarize = (list) => ({
    ok: list.every((layer) => layer.ok),
    passed: list.filter((layer) => layer.ok).length,
    total: list.length,
  });
  const baseSummary = {
    host: { ok: true, passed: 0, total: 0 },
    runtime: summarize(byKind("runtime")),
    config: summarize(byKind("config")),
    layout: { ok: true, passed: 0, total: 0 },
  };
  const uncertain = layers.filter((layer) => ["unknown", "inferred"].includes(layer.state));
  const failed = layers.filter((layer) => !layer.ok);
  const brokenLayers = layers.filter((layer) => layer.state === "broken");
  const allOk = failed.length === 0 && brokenLayers.length === 0;
  return {
    ok: allOk,
    state: brokenLayers.length ? "broken" : uncertain.some((layer) => layer.state === "unknown") ? "unknown" : uncertain.length ? "inferred" : "ok",
    needsApply: false,
    note: "v2.1.0：宿主源码补丁层已移除；自检只覆盖运行时注入与 profile 权限选择。",
    summary: {
      ...baseSummary,
      pending: { layers: 0, patches: 0 },
      uncertain: { layers: uncertain.length },
      broken: { layers: brokenLayers.length },
    },
    host,
    host_version: compat.host_version,
    qualified: compat.qualified,
    level: compat.level,
    patch: { applied: 0, total: 0, all: 0, na: 0, skipped: 0, missing_file: 0, off: 0, disabled: 0, not_applicable: 0, partial: 0 },
    layers,
    hints: failed.map((layer) => ({
      title: layer.title,
      action: layer.kind === "config"
        ? "权限选择仅作参考；v2.1.0 后插件不再修改宿主权限。"
        : "运行 `purge-community probe new` 检查注入是否到达模型；确认 unrestricted / redteam 预设。",
    })),
  };
}
