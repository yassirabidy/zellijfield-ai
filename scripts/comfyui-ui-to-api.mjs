#!/usr/bin/env node
// Convert a ComfyUI workflow saved in UI format (nodes + links) into API format (the body of
// POST /prompt), keeping the original node ids. Widget values are mapped to input names with the
// running ComfyUI's /object_info, so the result matches exactly the installed node versions.
//
//   node scripts/comfyui-ui-to-api.mjs <ui-workflow.json> <object_info.json | http://comfyui:8188> <out.json>
//
// Handles: notes (dropped), muted nodes (dropped), bypassed nodes (inputs passed through by type),
// Reroute, PrimitiveNode, and KJNodes SetNode/GetNode virtual wires.

import fs from 'node:fs/promises';

const VIRTUAL = new Set(['Note', 'MarkdownNote', 'Reroute', 'PrimitiveNode', 'SetNode', 'GetNode']);
const WIDGET_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO']);
const MODE_MUTED = 2;
const MODE_BYPASS = 4;

async function loadObjectInfo(source) {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(new URL('/object_info', source));
    if (!res.ok) throw new Error(`GET /object_info failed: HTTP ${res.status}`);
    return res.json();
  }
  return JSON.parse(await fs.readFile(source, 'utf8'));
}

// Ordered widget inputs of a node class: [{ name, controlAfterGenerate }]
function widgetInputs(info) {
  const out = [];
  for (const group of ['required', 'optional']) {
    for (const [name, spec] of Object.entries(info.input?.[group] ?? {})) {
      const [type, opts = {}] = spec;
      const isWidget = Array.isArray(type) || WIDGET_TYPES.has(type) || opts.forceInput === false;
      if (!isWidget || opts.forceInput) continue;
      out.push({ name, controlAfterGenerate: Boolean(opts.control_after_generate) || (type === 'INT' && /^(noise_)?seed$/.test(name)) });
    }
  }
  return out;
}

export function convert(ui, objectInfo) {
  const nodes = new Map(ui.nodes.map((n) => [n.id, n]));
  const links = new Map((ui.links ?? []).map((l) => [l[0], { from: l[1], fromSlot: l[2], to: l[3], toSlot: l[4], type: l[5] }]));
  const setNodes = new Map();
  for (const n of ui.nodes) if (n.type === 'SetNode') setNodes.set(n.widgets_values?.[0], n);

  // Follow virtual nodes back to a real [nodeId, slot] source.
  function resolve(linkId, depth = 0) {
    if (depth > 50) throw new Error('link resolution loop');
    const link = links.get(linkId);
    if (!link) return null;
    const src = nodes.get(link.from);
    if (!src || src.mode === MODE_MUTED) return null;
    // Reroute and SetNode both pass their single input straight through.
    if (src.type === 'Reroute' || src.type === 'SetNode') return resolve(src.inputs?.[0]?.link, depth + 1);
    if (src.type === 'GetNode') {
      const setter = setNodes.get(src.widgets_values?.[0]);
      return setter ? resolve(setter.inputs?.[0]?.link, depth + 1) : null;
    }
    if (src.mode === MODE_BYPASS) {
      const pass = (src.inputs ?? []).find((i) => i.link != null && i.type === link.type);
      return pass ? resolve(pass.link, depth + 1) : null;
    }
    return [String(src.id), link.fromSlot];
  }

  // PrimitiveNode outputs feed a literal value into the target widget.
  function primitiveValue(linkId) {
    const link = links.get(linkId);
    const src = link && nodes.get(link.from);
    return src?.type === 'PrimitiveNode' ? src.widgets_values?.[0] : undefined;
  }

  const prompt = {};
  const warnings = [];
  for (const node of ui.nodes) {
    if (VIRTUAL.has(node.type) || node.mode === MODE_MUTED || node.mode === MODE_BYPASS) continue;
    const info = objectInfo[node.type];
    if (!info) {
      warnings.push(`node ${node.id}: class "${node.type}" is not installed in this ComfyUI`);
      continue;
    }
    const inputs = {};
    const widgets = widgetInputs(info);
    const values = node.widgets_values;
    if (Array.isArray(values)) {
      let i = 0;
      for (const w of widgets) {
        if (i >= values.length) break;
        inputs[w.name] = values[i++];
        if (w.controlAfterGenerate && typeof values[i] === 'string' && /^(fixed|increment|decrement|randomize)$/.test(values[i])) i++;
      }
    } else if (values && typeof values === 'object') {
      for (const w of widgets) if (w.name in values) inputs[w.name] = values[w.name];
    }
    for (const input of node.inputs ?? []) {
      if (input.link == null) continue;
      const literal = primitiveValue(input.link);
      if (literal !== undefined) {
        inputs[input.name] = literal;
        continue;
      }
      const src = resolve(input.link);
      if (src) inputs[input.name] = src;
      else delete inputs[input.name];
    }
    prompt[String(node.id)] = { class_type: node.type, inputs, _meta: { title: node.title ?? info.display_name ?? node.type } };
  }
  return { prompt, warnings };
}

async function main() {
  const [uiPath, infoSource, outPath] = process.argv.slice(2);
  if (!uiPath || !infoSource || !outPath) {
    console.error('usage: node scripts/comfyui-ui-to-api.mjs <ui-workflow.json> <object_info.json|http://host:8188> <out.json>');
    process.exit(2);
  }
  const ui = JSON.parse(await fs.readFile(uiPath, 'utf8'));
  if (!Array.isArray(ui.nodes)) throw new Error(`${uiPath} is not a UI-format workflow (no "nodes" array)`);
  const { prompt, warnings } = convert(ui, await loadObjectInfo(infoSource));
  for (const w of warnings) console.warn(`warning: ${w}`);
  await fs.writeFile(outPath, `${JSON.stringify(prompt, null, 2)}\n`);
  console.log(`wrote ${outPath}: ${Object.keys(prompt).length} nodes`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('comfyui-ui-to-api.mjs')) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
