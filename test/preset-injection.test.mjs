// [mode-allowlist] 运行时提示词注入链的会话策略契约：
// 默认仅在 unrestricted（无限制模式）与 redteam（红队模式）下生效，
// 其余预设一律不注入；读不出预设按不注入处理（fail-closed）；
// excludePresets 保留为叠加排除；injectPresets 可覆盖白名单。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_INJECT_PRESETS, injectionPolicy, allowedPresetIds, withoutPurgeInjection, isPurgeSection, requestInjectionContext } from '../lib/preset-injection.js';
import { registerPromptSections, rewriteLiveAssembly, installHungPromptGlobal } from '../lib/index.js';
import { ALL_PATCHES, applyReplacementsToText } from '../lib/core.js';
import { writeTuning } from '../lib/tuning.js';
import { createProbe } from '../lib/probe.js';

const config = {
  enabled: true,
  injectPresets: ['unrestricted', 'redteam', 'roleplay'],
  excludePresets: [' RolePlay '],
  postPrompt: 'POST SENTINEL',
  postPromptOrder: 5100,
};
const context = id => ({agent: {session: {header: {agentPreset: id}}}});
const original = () => ({sections: [
  {name: 'harness:identity', text: 'NATIVE IDENTITY'},
  {name: 'deployment:persona-prefix', text: 'NATIVE PERSONA {{literal}}'},
  {name: 'workspace:agents-md', text: 'USER RULES'},
  {name: 'external', text: 'A user can quote dsh-purge without losing this text.'},
], tools: [{name: 'read'}], variables: {literal: 'value'}, contexts: [{name: 'cwd', text: '/fixture'}]});
async function isolated(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'purge53-'));
  const before = process.env.DSH_HOME;
  const oldHung = globalThis.__dshPurgeHungPrompt;
  process.env.DSH_HOME = home;
  fs.writeFileSync(path.join(home, 'prompt-inject.md'), 'ORDINARY PROMPT SENTINEL');
  try { return await fn(home); } finally {
    if (before === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = before;
    globalThis.__dshPurgeHungPrompt = oldHung;
    fs.rmSync(home, {recursive: true, force: true});
  }
}

test('default allowlist is unrestricted + redteam', () => {
  assert.deepEqual([...DEFAULT_INJECT_PRESETS], ['unrestricted', 'redteam']);
  assert.deepEqual(allowedPresetIds({}), ['unrestricted', 'redteam']);
  assert.deepEqual(allowedPresetIds({injectPresets: [' Standard ', 7, 'ptc']}), ['standard', 'ptc']);
});

test('only allowlisted presets inject; everything else is untouched', () => {
  for (const id of ['unrestricted', 'redteam', '红队演练', 'red-team']) {
    const p = injectionPolicy(config, context(id));
    assert.equal(p.allowed, true, `${id} must be allowlisted`);
  }
  for (const id of ['standard', 'minimal', 'ptc', 'cordis', 'liangshen', 'unrestricted-extra', 'roleplay-extra', '']) {
    const p = injectionPolicy(config, context(id));
    assert.equal(p.allowed, false, `${id || '(empty)'} must not inject`);
  }
  // 白名单命中但被 excludePresets 排除：叠加排除仍然生效。
  const excluded = injectionPolicy(config, context('roleplay'));
  assert.equal(excluded.allowlisted, true);
  assert.equal(excluded.excluded, true);
  assert.equal(excluded.allowed, false);
});

test('injectPresets can override the allowlist; enabled=false wins over everything', () => {
  assert.equal(injectionPolicy({injectPresets: ['standard']}, context('standard')).allowed, true);
  assert.equal(injectionPolicy({injectPresets: ['standard']}, context('unrestricted')).allowed, false);
  for (const list of [undefined, null, [], '', [null, 7, ' ']]) {
    assert.equal(injectionPolicy({excludePresets:list}, context('unrestricted')).allowed, true);
  }
  assert.equal(injectionPolicy({enabled:false}, context('unrestricted')).allowed, false);
});

test('unreadable contexts never leak (fail-closed on the allowlist)', () => {
  for (const c of [null, {}, {get agent(){throw Error('dead scope');}}]) {
    const p = injectionPolicy(config, c);
    assert.equal(p.allowed, false);
    assert.equal(p.unknown, true);
  }
});

test('preset IDs: exact normalized match, mounted > event > projection > header', () => {
  const c = context('standard');
  c.agent.session.events = [{type: 'agent-preset/selected', data: {agentPreset: 'minimal'}}];
  assert.equal(injectionPolicy(config, c).preset, 'minimal');
  c.agent.ctx = {agentPresets: {composedPreset: () => ({id:'unrestricted'})}};
  assert.equal(injectionPolicy(config, c).allowed, true);
  c.agent.ctx.agentPresets.composedPreset = () => ({id:'minimal'});
  assert.equal(injectionPolicy(config, c).allowed, false);
});

test('subagents use their own effective preset, not another session or parent', () => {
  for (const [child, allowed] of [['minimal',false],['unrestricted',true],['',false]]) {
    const c = context(child); c.agent.session.header.origin='subagent'; c.agent.session.header.parentSession='unrestricted-parent';
    c.agent.ctx = {agents: {get: () => ({session:context('unrestricted').agent.session})}};
    assert.equal(injectionPolicy(config, c).allowed, allowed);
  }
});

test('redteam children inherit through the parent-chain fallback even with a stale projection', () => {
  const c = context('');
  c.agent.session.header.origin = 'subagent';
  c.agent.session.header.parentSession = 'red-parent';
  c.agent.ctx = {agents: {get: () => ({session: {header: {agentPreset: 'red-team'}}})}};
  assert.equal(injectionPolicy(config, c).allowed, true);
});

for (const position of ['head','tail','both']) test(`${position}: every registered section evaluates the current session`, () => isolated(home => {
  writeTuning({injectPosition:position},home);createProbe(home);
  const specs=[];registerPromptSections({systemPrompt:{section:s=>specs.push(s)}},config);
  for(const id of ['standard','minimal','roleplay','unrestricted','redteam']) {
    const values=specs.map(s=>s.text(context(id)));
    if(id==='unrestricted'||id==='redteam') {
      assert(values.filter(Boolean).length>=5, `${id}: inject sections must carry text`);
      const assembled={...original(),sections:[...original().sections,...specs.map(s=>({name:s.name,text:s.text(context(id))}))]};
      const result=rewriteLiveAssembly(config,assembled,context(id));
      for(const name of ['dsh-purge-boost','dsh-purge:post','dsh-purge:probe'])assert(result.sections.some(s=>s.name===name&&s.text),name);
    }
    else assert(values.every(s=>s===''), `${id}: non-allowlisted presets must get empty sections`);
  }
}));

test('non-allowlisted assembly returns native content and drops stale plugin sections', () => isolated(() => {
  const clean=original();
  const dirty={...clean,sections:[...clean.sections,...['dsh-purge','dsh-purge-tail','dsh-purge-boost','dsh-purge:probe','dshpg-capabilities','dsh-purge:post'].map(name=>({name,text:'STALE'}))]};
  const snapshot=structuredClone(dirty);
  for (const id of ['minimal','standard']) {
    assert.deepEqual(rewriteLiveAssembly(config,dirty,context(id)),clean, `${id} returns the native assembly`);
  }
  assert.deepEqual(dirty,snapshot);
  // 白名单外的改写不会剥掉官方身份段。
  const out = rewriteLiveAssembly(config, original(), context('standard'));
  assert(out.sections.some(s=>s.name==='harness:identity'&&s.text==='NATIVE IDENTITY'));
  assert.equal(out.sections.some(s=>s.name==='dsh-purge'&&s.text), false);
}));

test('switching presets removes owned rewrites and restores native sections without losing downstream edits', () => isolated(() => {
  const clean=original();
  const active=rewriteLiveAssembly(config,clean,context('unrestricted'));
  assert(active.sections.some(isPurgeSection));
  const copy={...active,sections:[...active.sections,{name:'other:late',text:'KEEP'}]};
  const restored=rewriteLiveAssembly(config,copy,context('standard'));
  assert.deepEqual(restored,{...clean,sections:[...clean.sections,{name:'other:late',text:'KEEP'}]});
  const changed={...active,sections:active.sections.map(s=>s.name==='external'?{...s,text:'DOWNSTREAM CHANGE'}:s)};
  assert.equal(withoutPurgeInjection(changed).sections.find(s=>s.name==='external').text,'DOWNSTREAM CHANGE');
  const again=rewriteLiveAssembly(config,restored,context('unrestricted'));
  assert(again.sections.some(isPurgeSection));
  assert.deepEqual(clean,original());
}));

test('default allowlist produces the same assembly as an explicit configuration', () => isolated(() => {
  const a=rewriteLiveAssembly({},original(),context('unrestricted'));
  const b=rewriteLiveAssembly({excludePresets:[]},original(),context('unrestricted'));
  assert.deepEqual(a,b);
}));

test('interleaved sessions and host fallback never share an allowlist decision', () => isolated(async () => {
  const hung=installHungPromptGlobal(config);
  await Promise.all(Array.from({length:100},async(_,i)=>{
    const c=context(i%2?'unrestricted':'standard');
    await new Promise(r=>setImmediate(r));
    const result=rewriteLiveAssembly(config,original(),c);
    assert.equal(result.sections.some(isPurgeSection),!!(i%2));
    assert.equal(Boolean(hung(c)),!!(i%2));
  }));
  assert.equal(hung(),'','legacy no-argument host fallback cannot resolve a preset and must stay empty');
  assert.equal(installHungPromptGlobal({})(),'','empty config without a preset context must not inject either');
}));

const patch=ALL_PATCHES.find(p=>p.id===87);
for(const call of ['globalThis.__dshPurgeHungPrompt()', 'dshPurgeHungFn()']) for(const nl of ['\n','\r\n']) test(`old host migration ${call} ${JSON.stringify(nl)} is idempotent and executes with current agent`, () => isolated(() => {
  const old=['// [dsh-purge-87] hang needle uses LF','const dshPurgeHungFn = globalThis.__dshPurgeHungPrompt;',`return ${call};`].join(nl);
  const next=applyReplacementsToText(old,patch);
  assert.equal(next.changed,true);assert.equal(applyReplacementsToText(next.text,patch).changed,false);
  if(nl==='\r\n')assert(!/(?<!\r)\n/.test(next.text));
  installHungPromptGlobal(config);
  const run=new Function(next.text);
  assert.equal(run.call(context('minimal').agent),'');
  assert.equal(run.call(context('standard').agent),'');
  assert(run.call(context('unrestricted').agent));
}));

test('LLM request lookup uses the exact session ID and preserves allowlisted-session behavior', () => {
  const agents=new Map(['unrestricted','standard'].map(id=>{const a=context(id).agent;a.session.id=id;return [id,a]}));
  const ctx={get:()=>({get:id=>agents.get(id)})};
  assert.equal(injectionPolicy(config,requestInjectionContext(ctx,{sessionId:'unrestricted'})).allowed,true);
  assert.equal(injectionPolicy(config,requestInjectionContext(ctx,{sessionId:'standard'})).allowed,false);
  assert.equal(requestInjectionContext(ctx,{sessionId:'gone'}),undefined);
  assert.equal(requestInjectionContext({get:()=>({get:()=>agents.get('unrestricted')})},{sessionId:'standard'}),undefined);
  assert.equal(requestInjectionContext(ctx,{}),undefined);
  agents.get('unrestricted').session.header.agentPreset='standard';
  assert.equal(injectionPolicy(config,requestInjectionContext(ctx,{sessionId:'unrestricted'})).allowed,false);
});
