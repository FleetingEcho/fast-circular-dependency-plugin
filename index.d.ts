export interface FastCircularDependencyPluginOptions {
  /** Exclude files from detection (tested against the CURRENT module's resource path) */
  exclude?: RegExp;
  /** Include only these files in detection (tested against the CURRENT module's resource path) */
  include?: RegExp;
  /** Push errors (instead of warnings) to the webpack compilation */
  failOnError?: boolean;
  /** Ignore async/weak edges when true (matches original plugin semantics) */
  allowAsyncCycles?: boolean;
  /** Base directory used to render relative paths in messages */
  cwd?: string;

  /** Called once before detection starts */
  onStart?: (args: { compilation: any }) => void;

  /**
   * Called for each cyclical MODULE encountered.
   * `paths` are relative module paths forming a cycle, e.g. ['a.js','b.js','a.js']
   * `module` is the webpack module record that triggered the detection.
   */
  onDetected?: (args: {
    module: any;
    paths: string[];
    compilation: any;
  }) => void;

  /** Called once after detection finishes */
  onEnd?: (args: { compilation: any }) => void;
}

/**
 * FastCircularDependencyPlugin
 * Drop-in replacement for circular-dependency-plugin (Webpack 4/5)
 */
declare class FastCircularDependencyPlugin {
  constructor(options?: FastCircularDependencyPluginOptions);
  apply(compiler: any): void;
}

export = FastCircularDependencyPlugin;
