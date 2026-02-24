import { runHarnessAnimate } from './harness-animate.ts';
import { runNimCli as runStandaloneNimCli } from '../packages/nim/src/index.ts';
import {
  createDefaultHarnessRuntimeApplication,
  type HarnessRuntimeApplication,
} from '../src/cli/runtime-app/application.ts';
import { parseGlobalCliOptions, parseSessionName } from '../src/cli/parsing/session.ts';

const app: HarnessRuntimeApplication = createDefaultHarnessRuntimeApplication();

export { parseGlobalCliOptions, parseSessionName };

export async function runGatewayCli(
  args: readonly string[],
  sessionName: string | null,
): Promise<number> {
  return await app.runGatewayCli(args, sessionName);
}

export async function runProfileCli(
  args: readonly string[],
  sessionName: string | null,
): Promise<number> {
  return await app.runProfileCli(args, sessionName);
}

export async function runStatusTimelineCli(
  args: readonly string[],
  sessionName: string | null,
): Promise<number> {
  return await app.runStatusTimelineCli(args, sessionName);
}

export async function runRenderTraceCli(
  args: readonly string[],
  sessionName: string | null,
): Promise<number> {
  return await app.runRenderTraceCli(args, sessionName);
}

export async function runAuthCli(
  args: readonly string[],
  sessionName: string | null,
): Promise<number> {
  return await app.runAuthCli(args, sessionName);
}

export function runUpdateCli(args: readonly string[], sessionName: string | null): number {
  return app.runUpdateCli(args, sessionName);
}

export async function runCursorHooksCli(
  args: readonly string[],
  sessionName: string | null,
): Promise<number> {
  return await app.runCursorHooksCli(args, sessionName);
}

export async function runDiffCli(
  args: readonly string[],
  sessionName: string | null,
): Promise<number> {
  return await app.runDiffCli(args, sessionName);
}

export async function runClientCli(
  args: readonly string[],
  sessionName: string | null,
): Promise<number> {
  return await app.runClientCli(args, sessionName);
}

export async function runAnimateCli(args: readonly string[]): Promise<number> {
  return await runHarnessAnimate(args);
}

export async function runNimCli(
  args: readonly string[],
  sessionName: string | null,
): Promise<number> {
  const argsWithSession = sessionName === null ? [...args] : ['--session-id', sessionName, ...args];
  return await runStandaloneNimCli(argsWithSession);
}
