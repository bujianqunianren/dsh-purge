// Session-local prompt policy. No global "last preset" state: parallel agents
// must make their own decision at every assembly and host fallback call.
//
// [mode-allowlist] The runtime prompt-injection chain only runs on presets in
// the allowlist. Default allowlist = unrestricted (无限制模式) + redteam (红队模式);
// every other preset (standard / minimal / ptc / cordis / liangshen / user-made)
// is left untouched. A context whose preset cannot be resolved is treated as
// NOT allowlisted (fail-closed: better a missing inject than a stray one).
// `excludePresets` stays as a stacked exclusion on top of the allowlist.
import { sessionAgentPreset, isRedteamSession } from './identity.js';

/** 默认注入白名单：无限制模式 + 红队模式。可通过 config.injectPresets 覆盖。 */
export const DEFAULT_INJECT_PRESETS = Object.freeze(['unrestricted', 'redteam']);

export function excludedPresetIds(config) {
  return Array.isArray(config?.excludePresets)
    ? config.excludePresets.filter(x => typeof x === 'string').map(x => x.trim().toLowerCase()).filter(Boolean)
    : [];
}

/**
 * 注入白名单。config.injectPresets 显式给出时以它为准（可包含自造预设 id），
 * 否则用默认的 unrestricted + redteam。
 */
export function allowedPresetIds(config) {
  const raw = Array.isArray(config?.injectPresets) && config.injectPresets.length > 0
    ? config.injectPresets
    : DEFAULT_INJECT_PRESETS;
  return raw.filter(x => typeof x === 'string').map(x => x.trim().toLowerCase()).filter(Boolean);
}

export function injectionPolicy(config, context) {
  const allow = allowedPresetIds(config);
  const ids = excludedPresetIds(config);
  let preset = '';
  try { preset = String(sessionAgentPreset(context) || '').trim().toLowerCase(); } catch { /* unavailable context */ }
  const listed = preset !== '' && allow.includes(preset);
  // 红队兜底：预设投影/会话头滞后、子代理沿父链时，isRedteamSession 仍能认出红队会话。
  let redteamListed = false;
  if (allow.includes('redteam')) {
    try { redteamListed = isRedteamSession(context); } catch { redteamListed = false; }
  }
  const allowlisted = listed || redteamListed;
  // Subagents use their own effective preset, not their parent's selection.
  // excludePresets 叠加排除：白名单命中但被显式排除的预设不注入。
  const excluded = !!preset && ids.includes(preset);
  const unknown = preset === '';
  return { preset, allowlisted, excluded, unknown, allowed: config?.enabled !== false && allowlisted && !excluded };
}

export function isPurgeSection(section) {
  const name = String(section?.name || '');
  return name === 'dsh-purge' || name.startsWith('dsh-purge-') || name.startsWith('dsh-purge:') || name.startsWith('dshpg-');
}

// Symbol survives ordinary {...assembly} copies but never renders or serializes.
// Only reverse our own known writes, never regex-delete user/persona text.
const ORIGINAL = Symbol.for('dsh-purge.prompt-provenance.v1');
export function withoutPurgeInjection(assembly, { keepPluginSections = false } = {}) {
  if (!Array.isArray(assembly?.sections)) return assembly;
  const record = assembly[ORIGINAL];
  const sections = assembly.sections.filter(s => {
    if (isPurgeSection(s)) return keepPluginSections;
    const prior = record?.written.find(p => p.name === s.name);
    return !(prior && prior.text === s.text && !record.original.some(p => p.name === s.name));
  }).map(s => {
    const prior = record?.written.find(p => p.name === s.name);
    const original = record?.original.find(p => p.name === s.name);
    return prior && original && prior.text === s.text ? { ...s, text: original.text } : s;
  });
  // Restore native sections removed by our previous rewrite, preserving any
  // later downstream additions/edits and their order.
  for (const original of record?.original || []) {
    if (isPurgeSection(original) || record.written.some(s => s.name === original.name) || sections.some(s => s.name === original.name)) continue;
    const index = record.original.indexOf(original);
    const following = new Set(record.original.slice(index + 1).map(s => s.name));
    const before = sections.findIndex(s => following.has(s.name));
    sections.splice(before < 0 ? sections.length : before, 0, original);
  }
  const clean = { ...assembly, sections };
  delete clean[ORIGINAL];
  return clean;
}

export function rememberPromptRewrite(original, rewritten) {
  if (!Array.isArray(original?.sections) || !Array.isArray(rewritten?.sections)) return rewritten;
  return { ...rewritten, [ORIGINAL]: {
    original: original.sections.map(s => ({ ...s })),
    written: rewritten.sections.map(s => ({ ...s })),
  } };
}

// LLM requests carry a sessionId, not an assembly context. Resolve that exact
// live agent; never use the last/current UI conversation or causal parent.
export function requestInjectionContext(ctx, options) {
  if (options?.context?.agent || options?.context?.session) return options.context;
  if (options?.agent || options?.session) return options;
  if (typeof options?.sessionId !== 'string' || !options.sessionId) return undefined;
  try {
    const registry = typeof ctx?.get === 'function' ? ctx.get('agents') : ctx?.agents;
    const agent = registry?.get(options.sessionId);
    return agent?.session?.id === options.sessionId ? { agent } : undefined;
  } catch { return undefined; }
}
