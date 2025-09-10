const path = require('path');
const PluginTitle = 'FastCircularDependencyPlugin';

class FastCircularDependencyPlugin {
  constructor(options = {}) {
    this.options = {
      // Official option surface
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
    const plugin = this;

    compiler.hooks.compilation.tap(PluginTitle, (compilation) => {
      // Use optimizeModules to match official tests; works in production too.
      const hook =
        (compilation.hooks && compilation.hooks.optimizeModules) ||
        compilation.hooks.finishModules;

      hook.tap(PluginTitle, (modules) => {
        if (plugin.options.onStart) plugin.options.onStart({ compilation });

        // Base dir for relative paths
        const baseDir = path.resolve(
          plugin.options.cwd || compiler.context || process.cwd()
        );
        const rel = (abs) => (abs ? path.relative(baseDir, abs) : '');

        // Deterministic module list: sort by resource path (matches official test ordering)
        const modList = [];
        for (const m of modules) if (m) modList.push(m);

        function getResource(m) {
          if (!m) return null;
          if (m.resource) return m.resource;
          if (m.rootModule && m.rootModule.resource) return m.rootModule.resource;
          if (m.originalModule && m.originalModule.resource) return m.originalModule.resource;
          return null;
        }

        modList.sort((a, b) => {
          const ra = getResource(a) || '';
          const rb = getResource(b) || '';
          if (ra < rb) return -1;
          if (ra > rb) return 1;
          return 0;
        });

        const idOf = new Map();
        for (let i = 0; i < modList.length; i++) idOf.set(modList[i], i);

        // IMPORTANT: match official traversal exactly: walk currentModule.dependencies,
        // resolve via moduleGraph.getModule(dependency) (WB5) or dependency.module (WB4).
        const mg = compilation.moduleGraph;
        function getDeps(m) {
          const deps = (m && m.dependencies) ? m.dependencies : [];
          const out = [];
          for (let i = 0; i < deps.length; i++) {
            const dep = deps[i];
            if (!dep) continue;

            // ignore webpack internal “self reference” deps (official)
            if (dep.constructor && dep.constructor.name === 'CommonJsSelfReferenceDependency') continue;

            // allowAsyncCycles semantics (official: only checks dependency.weak)
            if (plugin.options.allowAsyncCycles && dep.weak) continue;

            // resolve module (WB5 vs WB4)
            let depModule = null;
            if (mg && typeof mg.getModule === 'function') {
              depModule = mg.getModule(dep);
            } else {
              depModule = dep.module;
            }
            if (!depModule) continue;

            // official: ignore deps with no resource
            if (!getResource(depModule)) continue;

            // avoid self-edges
            if (depModule === m) continue;

            out.push(depModule);
          }
          return out;
        }

        // Build adjacency
        const N = modList.length;
        const adj = Array(N);
        for (let i = 0; i < N; i++) adj[i] = [];
        for (let i = 0; i < N; i++) {
          const from = modList[i];
          const list = getDeps(from);
          for (let k = 0; k < list.length; k++) {
            const dep = list[k];
            const j = idOf.get(dep);
            if (j == null) continue;
            adj[i].push(j);
          }
        }

        // Tarjan SCC
        let index = 0;
        const idx = new Array(N);
        const low = new Array(N);
        const onSt = new Array(N);
        const sccId = new Array(N);
        for (let i = 0; i < N; i++) { idx[i] = -1; low[i] = 0; onSt[i] = false; sccId[i] = -1; }
        const st = [];
        const sccs = [];

        function strongconnect(v) {
          idx[v] = index; low[v] = index; index++;
          st.push(v); onSt[v] = true;
          const edges = adj[v];
          for (let a = 0; a < edges.length; a++) {
            const w = edges[a];
            if (idx[w] === -1) {
              strongconnect(w);
              low[v] = low[v] < low[w] ? low[v] : low[w];
            } else if (onSt[w]) {
              low[v] = low[v] < idx[w] ? low[v] : idx[w];
            }
          }
          if (low[v] === idx[v]) {
            const comp = [];
            let w;
            do {
              w = st.pop();
              onSt[w] = false;
              comp.push(w);
              sccId[w] = sccs.length;
            } while (w !== v);
            sccs.push(comp);
          }
        }
        for (let v = 0; v < N; v++) if (idx[v] === -1) strongconnect(v);

        // Mark SCCs invalid (not a cycle or any member missing resource)
        const sccInvalid = new Array(sccs.length);
        for (let s = 0; s < sccs.length; s++) {
          const comp = sccs[s];
          let bad = comp.length <= 1;
          if (!bad) {
            for (let i = 0; i < comp.length; i++) {
              const r = getResource(modList[comp[i]]);
              if (!r) { bad = true; break; }
            }
          }
          sccInvalid[s] = bad;
        }

        // Find a simple cycle starting/ending at `start` within an SCC
        function findCycleFrom(start, compSet) {
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
            cyc.push(start); // close loop
            return cyc;
          }
          return null;
        }

        // Emit once per MODULE in a cyclic SCC (official behavior), in resource-sorted order.
        for (let mIdx = 0; mIdx < modList.length; mIdx++) {
          const m = modList[mIdx];
          const i = idOf.get(m);
          if (i == null) continue;

          const k = sccId[i];
          if (k < 0 || sccInvalid[k]) continue;

          const resource = getResource(m);
          if (!resource) continue;

          // include/exclude on CURRENT module only (official behavior)
          if (this.options.exclude.test(resource)) continue;
          if (!this.options.include.test(resource)) continue;

          const comp = sccs[k];
          const compSet = new Set(comp);

          let cycleIdx = findCycleFrom(i, compSet);
          if (!cycleIdx) {
            // minimal fallback (should rarely trigger)
            const nb = adj[i].find((w) => compSet.has(w));
            if (typeof nb === 'number') cycleIdx = [i, nb, i];
          }
          if (!cycleIdx) continue;

          // Build relative paths
          const relPaths = [];
          for (let p = 0; p < cycleIdx.length; p++) {
            const modR = getResource(modList[cycleIdx[p]]);
            relPaths.push(rel(modR || ''));
          }

          const msg = 'Circular dependency detected:\r\n' + relPaths.join(' -> ');

          if (plugin.options.onDetected) {
            try {
              // Official tests expect relative paths in onDetected as well
              plugin.options.onDetected({ module: m, paths: relPaths, compilation });
            } catch (err) {
              compilation.errors.push(err);
            }
          } else {
            const e = new Error(msg);
            if (plugin.options.failOnError) compilation.errors.push(e);
            else compilation.warnings.push(e);
          }
        }

        if (plugin.options.onEnd) plugin.options.onEnd({ compilation });
      });
    });
  }
}

module.exports = FastCircularDependencyPlugin;