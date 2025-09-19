const path = require('path');
const PluginTitle = 'FastCircularDependencyPlugin';

/**
* @typedef {Object} FastCircularDependencyPluginOptions
* @property {RegExp} [exclude]
* @property {RegExp} [include]
* @property {boolean} [failOnError]
* @property {boolean} [allowAsyncCycles]
* @property {string} [cwd]
* @property {(args: { compilation: any }) => void} [onStart]
* @property {(args: { module: any, paths: string[], compilation: any }) => void} [onDetected]
* @property {(args: { compilation: any }) => void} [onEnd]
*/


/** Get a module's resource from webpack. */
function getModuleResource(m) {
  if (!m) return null;
  if (m.resource) return m.resource;
  if (m.rootModule && m.rootModule.resource) return m.rootModule.resource;
  if (m.originalModule && m.originalModule.resource) return m.originalModule.resource;
  return null;
}

/** Deterministic, resource-sorted module list (matches official test ordering). */
function createSortedModuleList(modules) {
  const list = [];
  for (const m of modules) if (m) list.push(m);
  list.sort((a, b) => {
    const ra = getModuleResource(a) || '';
    const rb = getModuleResource(b) || '';
    if (ra < rb) return -1;
    if (ra > rb) return 1;
    return 0;
  });
  return list;
}

/**
* Collect resolved dependency modules for a given module.
* Honors WB5 moduleGraph, ignores self-ref deps, and skips weak deps when allowAsyncCycles is true.
*/
function collectModuleDependencies(mod, moduleGraph, allowAsyncCycles) {
  const deps = (mod && mod.dependencies) ? mod.dependencies : [];
  const out = [];

  for (let i = 0; i < deps.length; i++) {
    const dep = deps[i];
    if (!dep) continue;

    // ignore webpack internal “self reference” deps (official)
    if (dep.constructor && dep.constructor.name === 'CommonJsSelfReferenceDependency') {
      continue;
    }

    // allowAsyncCycles semantics (official: only checks dependency.weak)
    if (allowAsyncCycles && dep.weak) continue;

    // resolve module
    let depModule = null;
    if (moduleGraph && typeof moduleGraph.getModule === 'function') {
      depModule = moduleGraph.getModule(dep);
    } else {
      depModule = dep.module;
    }
    if (!depModule) continue;

    // official: ignore deps with no resource
    if (!getModuleResource(depModule)) continue;

    // avoid self-edges
    if (depModule === mod) continue;

    out.push(depModule);
  }
  return out;
}

/** Build adjacency list over the sorted module list. */
function buildAdjacencyList(modList, idOf, compilation, allowAsyncCycles) {
  const N = modList.length;
  const adj = Array.from({ length: N }, () => []);
  const mg = compilation.moduleGraph;

  for (let i = 0; i < N; i++) {
    const from = modList[i];
    const deps = collectModuleDependencies(from, mg, allowAsyncCycles);
    for (let k = 0; k < deps.length; k++) {
      const dep = deps[k];
      const j = idOf.get(dep);
      if (j == null) continue;
      adj[i].push(j);
    }
  }
  return adj;
}

/** Compute SCCs using Tarjan (O(V+E)). Returns sccs. */
function computeStronglyConnectedComponents(adj) {
  const N = adj.length;
  let index = 0;
  const idx = new Array(N).fill(-1);
  const low = new Array(N).fill(0);
  const onStack = new Array(N).fill(false);
  const stack = [];
  const sccs = [];

  function strongConnect(v) {
    idx[v] = index;
    low[v] = index;
    index++;
    stack.push(v);
    onStack[v] = true;

    const edges = adj[v];
    for (let a = 0; a < edges.length; a++) {
      const w = edges[a];
      if (idx[w] === -1) {
        strongConnect(w);
        low[v] = Math.min(low[v], low[w]);
      } else if (onStack[w]) {
        low[v] = Math.min(low[v], idx[w]);
      }
    }

    if (low[v] === idx[v]) {
      const comp = [];
      while (stack.length) {
        const w = stack.pop();
        onStack[w] = false;
        comp.push(w);
        if (w === v) break;
      }
      sccs.push(comp);
    }
  }

  for (let v = 0; v < N; v++) {
    if (idx[v] === -1) strongConnect(v);
  }

  return sccs;
}

/** Mark SCCs that are not cycles (size<=1) or contain nodes without resources. */
function flagInvalidComponents(sccs, resOf) {
  const invalid = new Array(sccs.length).fill(false);
  for (let s = 0; s < sccs.length; s++) {
    const comp = sccs[s];
    let bad = comp.length <= 1;
    if (!bad) {
      for (let i = 0; i < comp.length; i++) {
        if (!resOf[comp[i]]) {
          bad = true;
          break;
        }
      }
    }
    invalid[s] = bad;
  }
  return invalid;
}

/** DFS to find a simple cycle starting/ending at `start` within a component set. */
function findSimpleCycleFrom(start, compSet, adj) {
  const seen = new Set();
  const stack = [];

  function dfs(u) {
    if (seen.has(u)) return false;
    seen.add(u);
    stack.push(u);

    const edges = adj[u];
    for (let a = 0; a < edges.length; a++) {
      const w = edges[a];
      if (!compSet.has(w)) continue;
      if (w === start && stack.length > 1) return true;
      if (!seen.has(w) && dfs(w)) return true;
    }

    stack.pop();
    return false;
  }

  if (dfs(start)) {
    const cyc = stack.slice();
    cyc.push(start); // close loop
    return cyc;
  }
  return null;
}

/** Create a function to relativize absolute paths to baseDir. */
function makeRelativizer(baseDir) {
  return (abs) => (abs ? path.relative(baseDir, abs) : '');
}

/** Sort an array of node indices by their resource paths. */
function sortIndicesByResource(indices, resOf) {
  indices.sort((ia, ib) => {
    const ra = resOf[ia] || '';
    const rb = resOf[ib] || '';
    if (ra < rb) return -1;
    if (ra > rb) return 1;
    return 0;
  });
  return indices;
}

/** @param {FastCircularDependencyPluginOptions} [options] */
class FastCircularDependencyPlugin {
  constructor(options = {}) {
    this.options = {
      exclude: new RegExp('$^'),
      include: new RegExp('.*'),
      failOnError: false,
      allowAsyncCycles: false,
      onDetected: null,
      onStart: null,
      onEnd: null,
      cwd: process.cwd(),
      ...options,
    };
  }

  apply(compiler) {
    const opts = this.options;

    compiler.hooks.compilation.tap(PluginTitle, (compilation) => {
      // Use optimizeModules to match official tests.
      const hook =
        (compilation.hooks && compilation.hooks.optimizeModules) ||
        compilation.hooks.finishModules;

      hook.tap(PluginTitle, (modules) => {
        if (opts.onStart) opts.onStart({ compilation });

        const baseDir = path.resolve(opts.cwd || compiler.context || process.cwd());
        const rel = makeRelativizer(baseDir);

        // 1) Deterministic module list + index map
        const modList = createSortedModuleList(modules);
        const idOf = new Map(modList.map((m, i) => [m, i]));

        // Cache each node's resource to avoid repeated lookups
        const resOf = modList.map(getModuleResource);

        // 2) Build adjacency
        const adj = buildAdjacencyList(modList, idOf, compilation, opts.allowAsyncCycles);

        // 3) SCCs
        const sccs = computeStronglyConnectedComponents(adj);

        // 4) Filter invalid SCCs and prebuild sets
        const sccInvalid = flagInvalidComponents(sccs, resOf);
        const compSets = sccs.map((comp) => new Set(comp));

        // 5) Emit once per MODULE in a cyclic SCC.
        //    Iterate ONLY over cyclic SCCs, and within each, visit members in resource order
        for (let k = 0; k < sccs.length; k++) {
          if (sccInvalid[k]) continue;

          const comp = sccs[k].slice();
          sortIndicesByResource(comp, resOf);
          const compSet = compSets[k];

          for (let i = 0; i < comp.length; i++) {
            const node = comp[i];
            const resource = resOf[node];
            if (!resource) continue;

            // include/exclude on CURRENT module only (official behavior)
            if (opts.exclude.test(resource)) continue;
            if (!opts.include.test(resource)) continue;

            // Try to find a simple cycle that includes this node
            let cycleIdx = findSimpleCycleFrom(node, compSet, adj);
            if (!cycleIdx) {
              // minimal fallback
              const nb = adj[node].find((w) => compSet.has(w));
              if (typeof nb === 'number') cycleIdx = [node, nb, node];
            }
            if (!cycleIdx) continue;

            // Build relative paths for message/callback
            const relPaths = cycleIdx.map((idx) => rel(resOf[idx] || ''));

            if (opts.onDetected) {
              try {
                opts.onDetected({
                  module: modList[node],
                  paths: relPaths,
                  compilation,
                });
              } catch (err) {
                compilation.errors.push(err);
              }
            } else {
              const msg = 'Circular dependency detected:\r\n' + relPaths.join(' -> ');
              const e = new Error(msg);
              if (opts.failOnError) compilation.errors.push(e);
              else compilation.warnings.push(e);
            }
          }
        }

        if (opts.onEnd) opts.onEnd({ compilation });
      });
    });
  }
}

module.exports = FastCircularDependencyPlugin;