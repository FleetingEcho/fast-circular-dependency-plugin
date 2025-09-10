# Fast Circular Dependency Plugin

> 🚀 A high-performance alternative to [circular-dependency-plugin](https://github.com/aackerman/circular-dependency-plugin).
> Built with **Tarjan's Strongly Connected Components (SCC) algorithm** for faster and more stable detection of circular dependencies in large-scale projects.

---

## Why use this?

The original plugin uses recursive DFS, which can get slow on large projects.
**FastCircularDependencyPlugin** introduces several improvements:

### 🔧 Key Optimizations
1. **Efficient algorithm**
   - Uses Tarjan's SCC algorithm to detect all cycles in a single traversal.
   - Significantly faster for projects with thousands of modules.

2. **Deterministic module ordering**
   - Matches the official plugin’s test results by sorting modules by their `resource` path.

3. **Accurate dependency resolution**
   - Resolves dependencies via `compilation.moduleGraph.getModule(dependency)` (Webpack 5) or `dependency.module` (Webpack 4).
   - Ignores **CommonJsSelfReferenceDependency**, missing resources, and async edges when `allowAsyncCycles` is enabled.

4. **Lifecycle hooks supported**
   - Full support for `onStart`, `onDetected`, and `onEnd`.
   - Call signatures and timing are consistent with the original plugin.

5. **Robust cycle detection**
   - Always finds a valid cycle path.
   - Includes a minimal fallback mechanism to avoid missing cycles.

---
## Install
```shell
npm i -D @fastdeps/circular-dependency-plugin
# or
pnpm add -D @fastdeps/circular-dependency-plugin
```

---

## Webpack Compatibility
- ✅ Webpack 4.0.1+
- ✅ Webpack 5.x
- ⚠️ Webpack 3 is **not supported** (same as the original v5 release)

---

## Basic Usage

```js
// webpack.config.js
const FastCircularDependencyPlugin = require('@fastdeps/circular-dependency-plugin')

module.exports = {
  entry: "./src/index",
  plugins: [
    new FastCircularDependencyPlugin({
      // exclude detection of files based on a RegExp
      exclude: /a\.js|node_modules/,
      // include only specific files based on a RegExp
      include: /dir/,
      // add errors to webpack instead of warnings
      failOnError: true,
      // allow import cycles that include an async import
      allowAsyncCycles: false,
      // set the current working directory for displaying module paths
      cwd: process.cwd(),
    })
  ]
}
```

## Advanced Usage

Supports the same lifecycle hooks as the original plugin:
```jsx
// webpack.config.js
const FastCircularDependencyPlugin = require('@fastdeps/circular-dependency-plugin')

module.exports = {
  entry: "./src/index",
  plugins: [
    new FastCircularDependencyPlugin({
      // called before cycle detection starts
      onStart({ compilation }) {
        console.log('start detecting webpack modules cycles');
      },
      // called for each detected cycle
      onDetected({ module, paths, compilation }) {
        // `paths` is an array of relative module paths that make up the cycle
        compilation.errors.push(new Error(paths.join(' -> ')))
      },
      // called after cycle detection ends
      onEnd({ compilation }) {
        console.log('end detecting webpack modules cycles');
      },
    })
  ]
}

```

✅ Drop-in replacement for the original plugin.

✅ Full API compatibility with all existing options and lifecycle hooks.

✅ Much faster on large projects thanks to Tarjan’s algorithm.


## Acknowledgments

This project is a high-performance fork and reimplementation of
[circular-dependency-plugin](https://github.com/aackerman/circular-dependency-plugin)
originally created by **Aaron Ackerman** and contributors.

Licensed under the ISC License.
