#!/usr/bin/env node
/**
 * snapshot.mjs — snapshot a Retell Conversation Flow and diff it around a risky edit.
 *
 * Use before letting Conductor (or any AI assistant) touch a flow. The snapshot is your
 * revert point; the diff verifies the "nothing else was touched" claim instead of trusting it.
 *
 *   node snapshot.mjs save <flow_id> <out.json>
 *   node snapshot.mjs diff <before.json> <after.json>
 *   node snapshot.mjs restore <flow_id> <before.json>     # revert nodes+tools to the snapshot
 *
 * Reads RETELL_API_KEY from the environment.
 *
 * Typical loop:
 *   node snapshot.mjs save <id> before.json
 *   ...let the assistant propose and apply changes...
 *   node snapshot.mjs save <id> after.json
 *   node snapshot.mjs diff before.json after.json
 */

const [, , cmd, a, b] = process.argv;
const fs = await import('node:fs/promises');
const KEY = process.env.RETELL_API_KEY;

const api = async (path, init = {}) => {
  if (!KEY) { console.error('RETELL_API_KEY not set'); process.exit(2); }
  const r = await fetch(`https://api.retellai.com/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!r.ok) { console.error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`); process.exit(2); }
  return r.json();
};

/** Fields that must never drift as a side effect of an unrelated edit. */
const INVARIANTS = ['model_choice', 'default_dynamic_variables', 'start_node_id', 'begin_tag_display_position'];

const outs = (n) => {
  const r = (n.edges ?? []).map((e) => e.destination_node_id);
  for (const k of ['always_edge', 'skip_response_edge', 'else_edge']) {
    if (n[k]?.destination_node_id) r.push(n[k].destination_node_id);
  }
  return r.filter(Boolean);
};

const reach = (flow, start) => {
  const byId = Object.fromEntries((flow.nodes ?? []).map((n) => [n.id, n]));
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const c = stack.pop();
    if (seen.has(c) || !byId[c]) continue;
    seen.add(c);
    stack.push(...outs(byId[c]));
  }
  return [...seen].sort();
};

if (cmd === 'save') {
  if (!a || !b) { console.error('usage: snapshot.mjs save <flow_id> <out.json>'); process.exit(2); }
  const flow = await api(`get-conversation-flow/${a}`);
  await fs.writeFile(b, JSON.stringify(flow, null, 1));
  console.log(`saved ${b} — ${flow.nodes?.length ?? 0} nodes, ${flow.tools?.length ?? 0} tools`);
  console.log(`  model: ${JSON.stringify(flow.model_choice)}`);
} else if (cmd === 'diff') {
  if (!a || !b) { console.error('usage: snapshot.mjs diff <before.json> <after.json>'); process.exit(2); }
  const before = JSON.parse(await fs.readFile(a, 'utf8'));
  const after = JSON.parse(await fs.readFile(b, 'utf8'));
  let changed = 0;

  console.log('\n=== INVARIANTS ===');
  for (const k of INVARIANTS) {
    const same = JSON.stringify(before[k]) === JSON.stringify(after[k]);
    console.log(`  ${same ? '✓' : '✗'} ${k}`);
    if (!same) {
      changed++;
      console.log(`      before: ${JSON.stringify(before[k])}`);
      console.log(`      after : ${JSON.stringify(after[k])}`);
    }
  }

  console.log('\n=== TOOLS ===');
  const tb = (before.tools ?? []).map((t) => t.name).sort();
  const ta = (after.tools ?? []).map((t) => t.name).sort();
  const added = ta.filter((n) => !tb.includes(n));
  const removed = tb.filter((n) => !ta.includes(n));
  if (added.length) { changed++; console.log(`  ✗ ADDED: ${added.join(', ')}  <-- a re-added tool can defeat a structural guarantee`); }
  if (removed.length) { changed++; console.log(`  ✗ REMOVED: ${removed.join(', ')}`); }
  if (!added.length && !removed.length) console.log(`  ✓ unchanged [${ta.join(', ')}]`);

  console.log('\n=== NODES ===');
  const nb = Object.fromEntries((before.nodes ?? []).map((n) => [n.id, n]));
  const na = Object.fromEntries((after.nodes ?? []).map((n) => [n.id, n]));
  const mod = Object.keys(na).filter((i) => JSON.stringify(nb[i]) !== JSON.stringify(na[i]));
  const gone = Object.keys(nb).filter((i) => !na[i]);
  console.log(`  count ${Object.keys(nb).length} -> ${Object.keys(na).length}`);
  if (gone.length) { changed++; console.log(`  ✗ DELETED: ${gone.join(', ')}`); }
  if (mod.length) console.log(`  changed: ${mod.map((i) => (nb[i] ? i : `${i} (NEW)`)).join(', ')}`);
  else console.log('  ✓ no node changed');

  console.log('\n=== REACHABILITY (every node, before -> after) ===');
  let drift = 0;
  for (const id of Object.keys(na)) {
    if (!nb[id]) continue;
    const rb = reach(before, id).join(',');
    const ra = reach(after, id).join(',');
    if (rb !== ra) {
      drift++; changed++;
      console.log(`  ✗ ${id}`);
      console.log(`      before: ${rb}`);
      console.log(`      after : ${ra}`);
    }
  }
  if (!drift) console.log('  ✓ topology identical — no branch gained or lost a path');

  console.log(`\n${changed ? `${changed} unexpected change(s) — review before keeping` : 'clean: only node content changed, structure intact'}\n`);
  process.exit(changed ? 1 : 0);
} else if (cmd === 'restore') {
  if (!a || !b) { console.error('usage: snapshot.mjs restore <flow_id> <before.json>'); process.exit(2); }
  const snap = JSON.parse(await fs.readFile(b, 'utf8'));
  await api(`update-conversation-flow/${a}`, {
    method: 'PATCH',
    body: JSON.stringify({ nodes: snap.nodes, tools: snap.tools, model_choice: snap.model_choice,
      default_dynamic_variables: snap.default_dynamic_variables, global_prompt: snap.global_prompt }),
  });
  console.log(`restored ${a} from ${b}`);
} else {
  console.error('usage: snapshot.mjs save|diff|restore ...');
  process.exit(2);
}
