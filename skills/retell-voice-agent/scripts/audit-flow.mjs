#!/usr/bin/env node
/**
 * audit-flow.mjs — static audit of a Retell Conversation Flow.
 *
 * Encodes defect classes found on real builds. Every check here corresponds to a bug
 * that shipped, or would have, and was invisible in the dashboard.
 *
 *   node audit-flow.mjs <flow.json|flow_id> [policy.json]
 *
 * With a flow_id, reads RETELL_API_KEY from the environment.
 *
 * policy.json (all keys optional):
 * {
 *   "forbiddenTools": ["book_appointment_cal"],
 *   "isolation": [{ "from": "safety_node", "mustNotReach": ["impersonate_node"] }],
 *   "articleVars": ["trade"]        // vars whose default may already carry "a/an"
 * }
 *
 * Exit 0 = no FAILs. Exit 1 = at least one FAIL. WARNs never fail the run —
 * they mark things a human must read (global-node conditions especially).
 */

const [, , src, policyPath] = process.argv;
if (!src) {
  console.error('usage: audit-flow.mjs <flow.json|flow_id> [policy.json]');
  process.exit(2);
}

const fs = await import('node:fs/promises');
const policy = policyPath ? JSON.parse(await fs.readFile(policyPath, 'utf8')) : {};

let flow;
if (src.endsWith('.json')) {
  flow = JSON.parse(await fs.readFile(src, 'utf8'));
} else {
  const key = process.env.RETELL_API_KEY;
  if (!key) { console.error('RETELL_API_KEY not set'); process.exit(2); }
  const r = await fetch(`https://api.retellai.com/get-conversation-flow/${src}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!r.ok) { console.error(`fetch failed: HTTP ${r.status}`); process.exit(2); }
  flow = await r.json();
}

const nodes = flow.nodes ?? [];
const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
const results = [];
const add = (level, check, msg) => results.push({ level, check, msg });

/** Every way a node can hand off. Missing one silently under-reports reachability. */
const outs = (n) => {
  const r = (n.edges ?? []).map((e) => e.destination_node_id);
  for (const k of ['always_edge', 'skip_response_edge', 'else_edge']) {
    if (n[k]?.destination_node_id) r.push(n[k].destination_node_id);
  }
  return r.filter(Boolean);
};

const reach = (start) => {
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const c = stack.pop();
    if (seen.has(c) || !byId[c]) continue;
    seen.add(c);
    stack.push(...outs(byId[c]));
  }
  return seen;
};

// 1 — Isolation. The hard guarantee. Re-run after EVERY edit.
for (const rule of policy.isolation ?? []) {
  if (!byId[rule.from]) { add('WARN', 'isolation', `node "${rule.from}" not found`); continue; }
  const seen = reach(rule.from);
  const viol = (rule.mustNotReach ?? []).filter((t) => seen.has(t));
  if (viol.length) add('FAIL', 'isolation', `"${rule.from}" can reach forbidden: ${viol.join(', ')}`);
  else add('PASS', 'isolation', `"${rule.from}" reaches only [${[...seen].join(', ')}]`);
}

// 2 — Global nodes BYPASS the reachability walk above. Always human-reviewed.
const globals = nodes.filter((n) => n.global_node_setting);
if (!globals.length) add('PASS', 'global-nodes', 'none defined');
for (const g of globals) {
  const cond = g.global_node_setting.condition ?? '';
  add('WARN', 'global-nodes',
    `"${g.id}" attaches to EVERY node — review its scope by hand:\n      condition: ${cond}`);
  if (!g.global_node_setting.go_back_conditions?.length) {
    add('WARN', 'global-nodes',
      `"${g.id}" has no go_back_conditions — confirm it is meant to terminate, not resume`);
  }
}

// 3 — Dead ends: a node that can neither transition nor end traps the caller.
for (const n of nodes) {
  if (n.type === 'end') continue;
  if (!outs(n).length && !n.global_node_setting) {
    add('FAIL', 'dead-end', `"${n.id}" (${n.type}) has no outgoing transition and is not an end node`);
  }
}

// 3b — Single-exit collection nodes: one edge with a multi-part condition means a caller
// who won't satisfy it has nowhere to go. This is the identity-loop class.
for (const n of nodes) {
  if (n.type !== 'conversation' || n.global_node_setting) continue;
  const o = outs(n);
  const cond = (n.edges ?? [])[0]?.transition_condition?.prompt ?? '';
  if (o.length === 1 && /\band\b|,/.test(cond) && !n.else_edge) {
    add('WARN', 'single-exit',
      `"${n.id}" has ONE exit gated on a multi-part condition — a caller who stalls cannot progress.\n      condition: ${cond}`);
  }
}

// 3c — Binary-offer nodes with only the accept edge: a node whose one edge condition
// reads as "caller agrees/accepts/confirms" and has no else_edge silently strands a "no
// thanks" — the caller declines and the flow has nowhere to send them (offer_calendar class).
for (const n of nodes) {
  if (n.type !== 'conversation' || n.global_node_setting || n.else_edge) continue;
  const o = outs(n);
  const cond = (n.edges ?? [])[0]?.transition_condition?.prompt ?? '';
  if (o.length === 1 && /\b(agrees?|accepts?|confirms?|says yes|wants to|opts? in)\b/i.test(cond)) {
    add('WARN', 'binary-offer',
      `"${n.id}" has ONE exit gated on an accept/confirm condition with no else_edge — a decline has nowhere to go.\n      condition: ${cond}`);
  }
}

// 4 — Terminal reachability: every node should be able to reach an end node.
const endIds = nodes.filter((n) => n.type === 'end').map((n) => n.id);
if (!endIds.length) add('FAIL', 'terminal', 'flow has NO end node — prompt text saying "end the call" is not an end node');
else {
  const stranded = nodes
    .filter((n) => n.type !== 'end' && !n.global_node_setting)
    .filter((n) => ![...reach(n.id)].some((r) => endIds.includes(r)))
    .map((n) => n.id);
  if (stranded.length) add('FAIL', 'terminal', `cannot reach any end node: ${stranded.join(', ')}`);
  else add('PASS', 'terminal', 'every node can reach an end node');
}

// 5 — Forbidden tools. Absence of the tool IS the safety guarantee.
const tools = flow.tools ?? [];
const names = tools.map((t) => t.name);
const bad = (policy.forbiddenTools ?? []).filter((f) => names.some((n) => n?.includes(f)));
if (bad.length) add('FAIL', 'forbidden-tools', `present but forbidden: ${bad.join(', ')}`);
else if (policy.forbiddenTools?.length) add('PASS', 'forbidden-tools', `none of [${policy.forbiddenTools.join(', ')}] attached`);

// 6 — Custom tool with query_params but no parameters schema: the LLM has nothing to fill,
// sends arguments "{}", and the endpoint receives empty values. Looks like a working fail-safe forever.
for (const t of tools) {
  if (t.type !== 'custom') continue;
  const hasQuery = t.query_params && Object.keys(t.query_params).length;
  const hasParams = t.parameters?.properties && Object.keys(t.parameters.properties).length;
  if (hasQuery && !hasParams) {
    add('FAIL', 'tool-schema',
      `"${t.name}" has query_params but NO parameters schema — LLM will send empty arguments`);
  }
  // parameter names colliding with dynamic variables resolve to the VARIABLE's default
  for (const p of Object.keys(t.parameters?.properties ?? {})) {
    if (p in (flow.default_dynamic_variables ?? {})) {
      add('FAIL', 'tool-schema',
        `"${t.name}" parameter "${p}" collides with a dynamic variable — {{${p}}} will substitute the variable default, not the caller's value`);
    }
  }
}

// 7 — Double-article: "a {{trade}}" where trade's default already begins with "a ".
const vars = flow.default_dynamic_variables ?? {};
for (const n of nodes) {
  const text = n.instruction?.text ?? '';
  for (const [k, v] of Object.entries(vars)) {
    if (typeof v !== 'string') continue;
    const leadsWithArticle = /^(a|an)\s/i.test(v);
    const hardcoded = new RegExp(`\\b(a|an)\\s+\\{\\{${k}\\}\\}`, 'i').test(text);
    if (leadsWithArticle && hardcoded) {
      add('FAIL', 'double-article',
        `"${n.id}" says "a {{${k}}}" but the default is "${v}" → renders "a ${v}"`);
    }
  }
}

// 8 — Empty-string defaults risk speaking a raw {{variable}} or an empty phrase.
for (const [k, v] of Object.entries(vars)) {
  if (v === '') {
    const spoken = nodes.filter((n) => (n.instruction?.text ?? '').includes(`{{${k}}}`)).map((n) => n.id);
    if (spoken.length) {
      add('WARN', 'empty-default',
        `"${k}" defaults to "" and is referenced by [${spoken.join(', ')}] — ensure it is only spoken when non-empty`);
    }
  }
}

const order = { FAIL: 0, WARN: 1, PASS: 2 };
results.sort((a, b) => order[a.level] - order[b.level]);
const icon = { FAIL: '✗', WARN: '!', PASS: '✓' };
console.log(`\nRetell flow audit — ${flow.conversation_flow_id ?? src}`);
console.log(`${nodes.length} nodes, ${tools.length} tools, ${globals.length} global\n`);
for (const r of results) console.log(`  ${icon[r.level]} [${r.check}] ${r.msg}`);

const fails = results.filter((r) => r.level === 'FAIL').length;
const warns = results.filter((r) => r.level === 'WARN').length;
console.log(`\n${fails} FAIL, ${warns} WARN\n`);
if (warns) console.log('WARNs are not auto-failures — global-node scope in particular must be read by a human.\n');
process.exit(fails ? 1 : 0);
