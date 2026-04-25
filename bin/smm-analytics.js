#!/usr/bin/env node
// Thin shim: load the compiled CLI. tsx is used in dev (npm run dev).
import('../dist/cli.js').catch((err) => {
  console.error(err);
  process.exit(1);
});
