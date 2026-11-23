import { patchNotApplicable as notApplicable, patchStateCategory, summarizePatchRows } from "./patch-state.mjs";
import { permissionState } from "./permission-state.js";
import { refinePresetDiagnostic } from "./preset-diagnostic.js";
// Purge self-check: prove, layer by layer, that the bypass actually exists on
// this machine — instead of trusting "插件装上了" as evidence.
// Derived from the dsh-purge patch table (MIT, Copyright (c) 2026 小杨).
import fs from "node:fs";
import { diskFs } from "./extract-asar.js";
import path from "node:path";
import * as core from "./core.js";
import { compatibility } from "./community.js";
import { resolveProfile, diagnosticHost, hostSurface, desktopResourcesForHost } from "./instance.js";

/**
 * 每一层都对应一条（或一组）真实补丁，`why` 说明"这层没了会发生什么"。
 * kind: host=宿主源码补丁，runtime=插件运行时注入，config=当前 profile 的选择。
 */
/**
 * 每一层都对应一条（或一组）真实补丁，`why` 说明"这层没了会发生什么"。
 * kind: host=宿主源码补丁，runtime=插件运行时注入，config=当前 profile 的选择。
 * [v2 分类重组] 拆审批 / 拆沙箱 / 拆护栏 / 摘牌类补丁（原 22 层中的 15 层）
 * 已退役：审批、沙箱、文件围栏回到官方行为；提示词层效果转入运行时改写
 * （仅 unrestricted / redteam 生效）。本表只覆盖 v2 保留的 33 条修复与
 * 便利条目。
 */
export const BYPASS_LAYERS = Object.freeze([
  { ids: [22, 23], title: "工具上限放宽", kind: "host",
    why: "read 行长/字节/条数上限放宽、子代理深度默认 3→10" },
  { ids: [24], title: "预设 web 抓取打开", kind: "host",
    why: "preset tool-web fetch 打开，模型可抓取网页" },
  { ids: [26, 28], optionalIds: [28], title: "极简/梁神预设保留注入槽", kind: "host",
    why: "minimal 预设 open inject；梁神 phase-1 不被剥掉（注入本身受模式白名单控制）" },
  { ids: [38, 39], title: "旧格式会话兼容", kind: "host",
    why: "v0 会话 mnemon summary / 0.1.2 persona text 兼容，旧会话不损坏" },
  { ids: [42], title: "设置 API 兼容", kind: "host",
    why: "旧宿主设置接口保留，两个配置合并丢字段 bug 修复" },
  { ids: [45], title: "官方桌面更新交接", kind: "host",
    why: "已下载的新版本由安装器接续安装，不再重新打开旧解包目录" },
  { ids: [52, 57], title: "日志默认与网关角色", kind: "host",
    why: "官方 session log 默认不上传；developer 角色仅 openai/azure 原生，第三方代理回退 system 保证提示词到达" },
  { ids: [54, 55, 72, 66, 67, 68], title: "会话循环稳定性", kind: "host",
    why: "undefined 段落/消息/内容兜底、每步替换系统提示、messages system 字段保持当前" },
  { ids: [56, 58, 75, 77], title: "回退不残留", kind: "host",
    why: "回退只藏被撤掉的那轮、标记不进模型请求、任务回收、append 即替换窗口" },
  { ids: [70], title: "极简终端网络句", kind: "host",
    why: "极简模式 shell 描述不再声明'本工具无网络'" },
  { ids: [74, 87, 88], title: "注入挂载与去重", kind: "host",
    why: "首轮 assemble 前挂默认提示词；悬空注入块按 LF 头尾锚点去重，不糊成两份" },
  { ids: [78, 82], title: "宿主启动与自愈", kind: "host",
    why: "声明的补丁文件缺失时从 .dshpurge.bak 自愈；缺 DSH_PROFILE 也能定位 profile" },
  { ids: [83, 84], optionalIds: [84], title: "桌面退出不弹崩溃框", kind: "host",
    why: "host 被信号杀或 code=0 正常退出不再弹 crash 对话框" },
  { ids: [91, 92], title: "桌面 cookie 与请求头", kind: "host",
    why: "cookie 名忽略端口防累积；请求头上限 256KB 兜住历史存量（431 修复）" },
  { ids: [95, 96], optionalIds: [95, 96], title: "inspector 帧预算", kind: "host",
    why: "Cordis 树预留记录开销，超限时保留上一帧不打崩" },
]);

function readProfileConfig(dshHome, options) {
  let file = "";
  try {
    const profile = resolveProfile(dshHome, options);
    file = path.join(profile.directory,"cordis.patch.yml");
    return {file, text:fs.readFileSync(file,"utf8"), profile};
  } catch (e) { return {file, text:"", error:e.message}; }
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
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    text = "";
  }
  const bytes = Buffer.byteLength(text, "utf8");
  return {
    file,
    bytes,
    ok: bytes > 0,
    note: bytes > 0
      ? `注入文件 ${bytes} 字节，会作为 dsh-purge section 每步重贴`
      : "注入文件为空：插件能加载，但没有内容可注入",
  };
}

export function tallyPatchStatus(status, patches = core.ALL_PATCHES) {
  const counts = summarizePatchRows(patches.map(patch => ({...patch, status:status[patch.id]})));
  const {applied, total, all, na, skipped, missing_file, off, disabled, not_applicable, partial} = counts;
  return {applied, total, all, na, skipped, missing_file, off, disabled, not_applicable, partial};
}

export function rollupLayers(status, hasHost, options = {}) {
  // 读不到补丁状态时 status 是空表：不能把「未知」折叠成「全部通过」。
  const statusFailed = Boolean(options.statusError);
  const layers = [];
  const metadata = new Map((options.patches || core.ALL_PATCHES).map(p => [p.id, p]));
  for (const layer of BYPASS_LAYERS) {
    const optionalIds = new Set(layer.optionalIds || []);
    const rows = layer.ids.map((id) => ({
      id,
      optional: metadata.has(id) ? !!metadata.get(id).optional : optionalIds.has(id),
      status: status[id] || (hasHost ? "unknown" : "unlocated"),
    }));
    // 仅明确不适用或可选目标缺失可排除；必需文件缺失不能伪装成成功。
    const required = rows.filter((row) => !notApplicable({...metadata.get(row.id), optional:row.optional}, row.status));
    const applied = rows.filter((row) => patchStateCategory(metadata.get(row.id), row.status) === "applied");
    const pending = required.filter((row) => row.status === "pending");
    // 待应用 != 打不上：前者点一次「应用」就好，后者才需要改锚点。
    // partial = 部分目标文件命中、另一个存在但没命中：必须显示为异常，不能报 ok。
    const broken = required.filter((row) => patchStateCategory(metadata.get(row.id), row.status) === "broken");
    const absent = rows.filter((row) => notApplicable({...metadata.get(row.id), optional:row.optional}, row.status));
    const unknown = statusFailed || rows.some((row) => patchStateCategory(metadata.get(row.id), row.status) === "unknown");
    const state = broken.length ? "broken" : unknown ? "unknown" : pending.length ? "pending" : "ok";
    layers.push({
      title: layer.title,
      why: layer.why,
      kind: layer.kind,
      ids: layer.ids,
      ok: state === "ok",
      state,
      applied: applied.length,
      required: required.length,
      total: rows.length,
      pending: pending.map((row) => row.id),
      absent: absent.map((row) => row.id),
      broken: broken.map((row) => ({ id: row.id, status: row.status })),
      note: statusFailed
        ? `读取补丁状态失败，这一层没有被核对：${options.statusError}`
        : rows.some(row => row.id === 76 && row.status === "unknown") && !statusFailed
          ? "当前预设无法静态核对：请检查可读性、YAML 格式与 persona.prefix；动态表达式不会执行，未知不代表已生效"
        : unknown ? "宿主未定位或返回状态不完整，无法核对这一层；不代表补丁未生效"
        : rows.some(row => row.status === "not_needed") ? "已只读核对当前预设正文，#76 无需处理；未计为已应用"
        : absent.length === rows.length ? "目标插件/预设未安装，这一层当前不适用" : "",
      ...(statusFailed ? { status_error: options.statusError } : {}),
    });
  }
  return layers;
}

/**
 * 逐层自检。
 * @param aiBase - 目标宿主 @deepseek-ai 根（空则只解析当前启动信息/显式环境）。
 * @param dshHome - DSH 数据目录（默认 core.findDshHome()）。
 */
export function resolveHost(aiBase, options = {}) {
  return diagnosticHost({...options, aiBase, diskReader: options.reader});
}

/** Read only the requested host, never a different installed Desktop application. */
export function hostLayoutLayer(host, reader = diskFs()) {
  const surface = hostSurface(host);
  const base = {title:"宿主磁盘布局",kind:"layout",ids:[],pending:[],broken:[]};
  if (surface === "web") return {...base,why:"当前目标是 npm/Web 宿主，桌面 app.asar 检查不适用",ok:true,state:"na",applicable:false,applied:0,total:0,required:0,note:"不适用（Web 宿主）",detail:{surface,asar_still_sealed:null}};
  if (surface === "unknown") return {...base,why:"未确定目标实例，不能用其他桌面安装代替",ok:false,state:"unknown",applied:0,total:1,broken:[],note:"未定位当前宿主，无法确认运行方式",detail:{surface,asar_still_sealed:null}};
  const resources = desktopResourcesForHost(host), archive=path.join(resources,"app.asar");
  let sealed = false;
  try { sealed=reader.statSync(archive).isFile(); }
  catch (e) {
    if (e.code !== "ENOENT") return {...base,why:"无法读取当前目标实例的打包状态",ok:false,state:"broken",applied:0,total:1,broken:[{id:"asar",status:"unreadable"}],detail:{surface,archive,error:e.message,asar_still_sealed:null}};
  }
  return {...base,why:"仅检查目标磁盘的 app.asar，不证明当前进程加载来源；运行入口证据见 host-status",ok:!sealed,state:sealed?"broken":"ok",applied:sealed?0:1,total:1,broken:sealed?[{id:"asar",status:"sealed"}]:[],detail:{surface,archive,asar_still_sealed:sealed}};
}

export async function selfCheck(aiBase, dshHome = core.findDshHome(), options = {}) {
  const host = resolveHost(aiBase, options);
  const compat = compatibility(host);
  const services=options.coreModule || core;
  let status = {};
  let statusError = "";
  let evidence = {};
  if (host) {
    try {
      const scope = {surface:hostSurface(host), dshHome};
      if (services.patchStatusDetail) {
        const report = await services.patchStatusDetail(host, services.ALL_PATCHES, scope);
        status = report.status;
        evidence = report.files;
      } else {
        status = await services.patchStatus(host, services.ALL_PATCHES, scope);
      }
      status=refinePresetDiagnostic(status,dshHome);
    }
    catch (e) { status={}; statusError=String(e && e.message ? e.message : e); }
  }
  const layers = rollupLayers(status, Boolean(host), {statusError, patches:services.ALL_PATCHES});
  // [v2] 原 #71（梁神身份行）逐文件证据特判随补丁退役；后续若再有
  // 多文件补丁需要逐文件证据，按 layer.patch_evidence 的同款结构扩展。
  // Some patches have no named layer; missing required targets still need to be
  // visible in the overall verdict, not just a smaller headline count.
  const grouped = new Set(BYPASS_LAYERS.flatMap(layer => layer.ids));
  const missing = services.ALL_PATCHES.filter(p => !grouped.has(p.id) && !p.optional && status[p.id] === "missing_file");
  if (missing.length) layers.push({
    title:"其他必需目标文件", kind:"host", why:"安装缺少必需目标文件，需要核对目标路径或安装完整性",
    ids:missing.map(p=>p.id), ok:false, state:"broken", applied:0, total:missing.length,
    pending:[], broken:missing.map(p=>({id:p.id,status:"missing_file"})),
  });
  const runtime = runtimeLayer(dshHome);
  layers.push({
    title: "运行时提示词注入",
    why: "prompt-inject.md 作为 dsh-purge section 参与每一步 system prompt 组装",
    kind: "runtime",
    ids: [],
    ok: runtime.ok,
    state: runtime.ok ? "ok" : "broken",
    applied: runtime.ok ? 1 : 0,
    total: 1,
    pending: [],
    broken: runtime.ok ? [] : [{ id: "inject", status: "empty" }],
    detail: runtime,
  });
  const config = configLayer(dshHome, options);
  layers.push({
    title: "当前 profile 的权限选择",
    why: "界面层的最后一道门：即使补丁失效，这个组合也不会弹审批",
    kind: "config",
    ids: [],
    ok: config.ok,
    state: config.state,
    note: config.note,
    applied: config.ok ? 1 : 0,
    total: 1,
    pending: [],
    broken: config.state === "broken" ? [{ id: "preset", status: `${config.preset}/${config.approval}` }] : [],
    detail: config,
  });
  layers.push(hostLayoutLayer(host, options.reader || diskFs()));

  const byKind = (kind) => layers.filter((layer) => layer.kind === kind && layer.applicable !== false);
  const summarize = (list) => ({
    ok: list.every((layer) => layer.ok),
    passed: list.filter((layer) => layer.ok).length,
    total: list.length,
  });
  const baseSummary = {
    host: summarize(byKind("host")),
    runtime: summarize(byKind("runtime")),
    config: summarize(byKind("config")),
    layout: summarize(byKind("layout")),
  };
  const uncertain = layers.filter((layer) => ["unknown", "inferred"].includes(layer.state));
  const failed = layers.filter((layer) => !layer.ok);
  const pendingLayers = layers.filter((layer) => layer.state === "pending");
  const brokenLayers = layers.filter((layer) => layer.state === "broken");
  return {
    ok: failed.length === 0,
    state: brokenLayers.length ? "broken" : pendingLayers.length ? "pending" : uncertain.some((layer) => layer.state === "unknown") ? "unknown" : uncertain.length ? "inferred" : "ok",
    needsApply: brokenLayers.length === 0 && pendingLayers.length > 0,
    summary: {
      ...baseSummary,
      pending: { layers: pendingLayers.length, patches: pendingLayers.reduce((n, l) => n + l.pending.length, 0) },
      uncertain: { layers: uncertain.length },
      broken: { layers: brokenLayers.length },
    },
    host,
    host_version: compat.host_version,
    qualified: compat.qualified,
    level: compat.level,
    patch: tallyPatchStatus(status, services.ALL_PATCHES),
    layers,
    hints: failed.map((layer) => ({
      title: layer.title,
      action: layer.kind === "config"
        ? (config.error || config.note)
        : layer.kind === "layout"
          ? (layer.detail?.asar_still_sealed === true
            ? "目标磁盘仍有 app.asar；运行 host-status 核对当前服务入口，磁盘状态不代表已加载，需要重启时由用户操作"
            : "无法确定当前目标实例的运行方式；请明确 DSH_BASE 或 PURGE_DSH_CLI，不扫描其他安装")
          : layer.kind === "runtime"
            ? "写入 prompt-inject.md 或在插件设置里保存一次提示词"
            : layer.status_error
              ? `读取补丁状态失败：${layer.status_error}；先解决这个报错，别据此重装或改权限`
              : layer.state === "unknown"
                ? (layer.note || "未定位当前宿主；请明确当前实例的 DSH_BASE 或 PURGE_DSH_CLI，不需要据此重装或改权限")
                : `运行 purge-community diagnose 看 #${layer.ids.join("/#")} 的锚点`,
    })),
  };
}
