// [dsh-purge] 提示词层补丁表（v2 分类重组后）。
// v2 退役条目（工作区前言强制化 #1-#3、身份句剥离 #4/#43/#71/#76、审批话术
// #5/#11/#12、梁神镜像句 #73 等）已按模式白名单方案转入运行时改写或彻底移除；
// 本表只保留对所有预设都成立、与安全边界无关的条目。
import { clearShellNetworkBan, SHELL_NETWORK_WEB, SHELL_NETWORK_SDK } from "./shared.mjs";
export const PATCHES = [
  {
    id: 70,
    name: "PRESET_SHELL_NETWORK",
    layer: "提示词",
    layer_en: "Prompt",
    desc: "极简模式终端不再写没有网络 / minimal shell drops no-network ban",
    file: ["preset-minimal", "preset-sdk-minimal"],
    strictFiles: true,
    skipIfMarked: true,
    replacements: [
      { pattern: SHELL_NETWORK_WEB, replace: clearShellNetworkBan(SHELL_NETWORK_WEB) },
      { pattern: SHELL_NETWORK_SDK, replace: clearShellNetworkBan(SHELL_NETWORK_SDK) },
    ],
    markers: ["[dsh-purge] preset shell network"],
  },
];
