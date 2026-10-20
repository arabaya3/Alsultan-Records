declare module "libraw-wasm/dist/libraw.js" {
  const factory: (opts: Record<string, unknown>) => Promise<unknown>;
  export default factory;
}
