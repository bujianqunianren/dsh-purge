// [mode-allowlist] 端到端契约：运行时注入链的"总开关与预设白名单"。
// 1) 清单声明：cordis.patch.yml 与代码默认白名单一致（unrestricted + redteam）。
// 2) 自动重试/自动续跑（continue-retry）与注入共用同一道预设门。
// 只测决策面，不触发宿主写盘、不调模型、不改用户配置。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_INJECT_PRESETS, injectionPolicy } from '../lib/preset-injection.js';
import { installContinueRetry } from '../lib/continue-retry.js';

test('cordis.patch.yml declares the same allowlist as the code default', () => {
  const manifest = fs.readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  assert.match(manifest, /injectPresets:\s*\[\s*"unrestricted",\s*"redteam"\s*\]/);
});

test('AGENTS.md documents the allowlist behavior', () => {
  const doc = fs.readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
  assert.match(doc, /仅在 unrestricted（无限制模式）与 redteam（红队模式）两个预设下生效/);
});

function scope() {
  const hooks = new Map();
  return {
    hooks,
    on(name, fn) { hooks.set(name, fn); return () => hooks.delete(name); },
  };
}

function agent(id, followupCalls) {
  return {
    id: `sess-${id}`,
    status: 'idle',
    session: {
      id: `sess-${id}`,
      header: { agentPreset: id },
      events: [{ type: 'turn/end', seq: 1, data: { turn: 1, reason: { kind: 'interrupted' } } }],
    },
    followup(message) { followupCalls.push(message); },
  };
}

function runtime() {
  const ctx = scope();
  const rt = installContinueRetry(ctx, {
    getConfig: () => ({ autoRetry: true, retryMax: 3, autoContinue: true, continueMax: 3, continueText: '继续' }),
    injectionAllowed: (a) => injectionPolicy({}, { agent: a }).allowed,
  });
  return { ctx, rt };
}

test('auto-retry only takes over allowlisted sessions', async () => {
  const { ctx, rt } = runtime();
  try {
    const handler = ctx.hooks.get('agent/request-error');
    assert.equal(typeof handler, 'function');
    const transport = { code: 'TRANSPORT' };
    // standard：白名单外 → 原样放行（undefined），不产生 retry 决策。
    const out1 = await handler({ agent: agent('standard', []), failure: transport, turn: 1, step: 1 }, async () => undefined);
    assert.equal(out1, undefined);
    // unrestricted：白名单内 → 接管为 {kind:"retry"}。
    const out2 = await handler({ agent: agent('unrestricted', []), failure: transport, turn: 2, step: 1 }, async () => undefined);
    assert.deepEqual(out2, { kind: 'retry' });
  } finally { rt.dispose(); }
});

test('auto-continue only sends "继续" for allowlisted sessions', async () => {
  const { ctx, rt } = runtime();
  const callsUnrestricted = [];
  const callsStandard = [];
  try {
    const handler = ctx.hooks.get('agent/status');
    handler({ status: 'idle', agent: agent('unrestricted', callsUnrestricted) });
    handler({ status: 'idle', agent: agent('standard', callsStandard) });
    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.equal(callsUnrestricted.length, 1);
    assert.match(callsUnrestricted[0]?.content?.[0]?.text ?? '', /继续/);
    assert.equal(callsStandard.length, 0);
  } finally { rt.dispose(); }
});

test('the allowlist default stays unrestricted + redteam (guard against accidental widening)', () => {
  assert.deepEqual([...DEFAULT_INJECT_PRESETS], ['unrestricted', 'redteam']);
  assert.equal(injectionPolicy({}, { agent: { session: { header: { agentPreset: 'unrestricted' } } } }).allowed, true);
  assert.equal(injectionPolicy({}, { agent: { session: { header: { agentPreset: 'standard' } } } }).allowed, false);
});
