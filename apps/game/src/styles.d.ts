// TypeScript 6 checks that side-effect imports resolve (noUncheckedSideEffectImports). Next.js bundles the
// global style sheet the root layout imports, and its own declarations cover only CSS modules.
declare module "*.css";
