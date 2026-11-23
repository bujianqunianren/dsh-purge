// [dsh-purge] 补丁汇总入口；导出与 core.js 原文逐字一致。
// v2 分类重组：拆审批 / 拆沙箱 / 拆护栏 / 摘牌 / 自我纠错堆共 55 条退役，
// 其中 #1-#3（工作区前言强制化）转入运行时改写（见 lib/identity.js
// strengthenWorkspaceIntro，仅 unrestricted / redteam 生效）。保留 33 条
// 与安全边界无关的修复与便利条目。
import { PATCHES } from './prompt.mjs';
import { CODE_PATCHES } from './code.mjs';
import { ENGINE_PATCHES } from './engine.mjs';
import { NEW_TOOL_PATCHES } from './new-tools.mjs';
import { OPT_IN_PATCHES } from './opt-in.mjs';
import { STABILITY_PATCHES } from './stability.mjs';

export const ALL_PATCHES = [...PATCHES, ...CODE_PATCHES, ...ENGINE_PATCHES, ...NEW_TOOL_PATCHES, ...OPT_IN_PATCHES, ...STABILITY_PATCHES];

/** 同一条清洗的升级链。Apply 仍按 ALL_PATCHES 全打，只有清洗页 / 计数展示合成一行。 */
export const PATCH_DISPLAY_GROUPS = {
  // v2 退役分组已随补丁删除：disclaimer[1,2,3]、approval_sentence[5,11,12]、
  // approval_policy[8,9,10]、hooks_deny[30,31]、hooks_steer[64,65]。
  desktop_update: [45],
  desktop_close: [83, 84],
  hang: [87, 88],
};
