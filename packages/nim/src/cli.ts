#!/usr/bin/env bun
import { runNimCli } from './index.ts';

const code = await runNimCli(process.argv.slice(2));
if (code !== 0) {
  process.exitCode = code;
}
