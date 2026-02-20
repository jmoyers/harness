import { diffUiUsage, runDiffUiCli } from '../src/diff-ui/index.ts';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${diffUiUsage()}\n`);
    process.exitCode = 0;
    return;
  }

  const result = await runDiffUiCli({
    argv,
  });
  process.exitCode = result.exitCode;
}

void main();
