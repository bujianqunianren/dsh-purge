// [dsh-purge] 代码层补丁表（v2 分类重组后）。
// 原 #6（沙箱 deny→allow file-write）、#7（默认 danger-full-access）、
// #8（审批默认 never）属"拆审批/拆沙箱"堆：v2 起不再改写宿主源码；
// unrestricted / redteam 会话的全权限改走 DSH 官方的会话/部署权限配置，
// 其余预设回到官方默认（workspace-write + ask），行为与未装插件一致。
export const CODE_PATCHES = [];
