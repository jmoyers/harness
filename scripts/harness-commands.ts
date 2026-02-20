import { Command, Flags } from '@oclif/core';
import {
  parseSessionName,
  runAnimateCli,
  runAuthCli,
  runClientCli,
  runCursorHooksCli,
  runGatewayCli,
  runNimCli,
  runProfileCli,
  runRenderTraceCli,
  runStatusTimelineCli,
  runUpdateCli,
} from './harness-runtime.ts';

const sessionFlag = Flags.string({
  description:
    'Session namespace used to isolate gateway record/log/db/profile/status-trace artifacts.',
});

interface SessionParseResult {
  sessionName: string | null;
  argv: readonly string[];
}

abstract class HarnessCommandBase extends Command {
  static override strict = false;

  protected extractSessionArg(argv: readonly string[]): SessionParseResult {
    const passthrough: string[] = [];
    let sessionName: string | null = null;

    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index]!;
      if (arg === '--session') {
        const value = argv[index + 1];
        if (value === undefined) {
          throw new Error('missing value for --session');
        }
        sessionName = parseSessionName(value);
        index += 1;
        continue;
      }
      passthrough.push(arg);
    }

    return {
      sessionName,
      argv: passthrough,
    };
  }

  protected exitIfNeeded(code: number): void {
    if (code !== 0) {
      this.exit(code);
    }
  }
}

class ClientCommand extends HarnessCommandBase {
  static override summary = 'Launch the mux client (default when no explicit command is provided).';

  static override usage = [
    '[--session <name>] [mux-args...]',
    'client [--session <name>] [mux-args...]',
  ];

  static override flags = {
    help: Flags.help({ char: 'h' }),
    session: sessionFlag,
  };

  override async run(): Promise<void> {
    const parsed = this.extractSessionArg(this.argv);
    const code = await runClientCli(parsed.argv, parsed.sessionName);
    this.exitIfNeeded(code);
  }
}

class GatewayCommand extends HarnessCommandBase {
  static override summary = 'Manage the control-plane gateway lifecycle and direct command calls.';

  static override usage = [
    'gateway [--session <name>] start [--host <host>] [--port <port>] [--auth-token <token>] [--state-db-path <path>]',
    'gateway [--session <name>] run [--host <host>] [--port <port>] [--auth-token <token>] [--state-db-path <path>]',
    'gateway [--session <name>] stop [--force] [--timeout-ms <ms>] [--cleanup-orphans|--no-cleanup-orphans]',
    'gateway [--session <name>] status',
    'gateway [--session <name>] restart [--host <host>] [--port <port>] [--auth-token <token>] [--state-db-path <path>]',
    'gateway [--session <name>] call --json \'{"type":"session.list"}\'',
    'gateway [--session <name>] gc [--older-than-days <days>]',
  ];

  static override flags = {
    help: Flags.help({ char: 'h' }),
    session: sessionFlag,
  };

  override async run(): Promise<void> {
    const parsed = this.extractSessionArg(this.argv);
    if (parsed.argv.length === 0) {
      this.error('missing gateway subcommand', { exit: 2 });
    }
    const code = await runGatewayCli(parsed.argv, parsed.sessionName);
    this.exitIfNeeded(code);
  }
}

class ProfileCommand extends HarnessCommandBase {
  static override summary =
    'Manage gateway/client CPU profiling and live inspector profiling sessions.';

  static override usage = [
    'profile [--session <name>] start [--profile-dir <path>]',
    'profile [--session <name>] stop [--timeout-ms <ms>]',
    'profile [--session <name>] run [--profile-dir <path>] [mux-args...]',
    'profile [--session <name>] [--profile-dir <path>] [mux-args...]',
  ];

  static override flags = {
    help: Flags.help({ char: 'h' }),
    session: sessionFlag,
  };

  override async run(): Promise<void> {
    const parsed = this.extractSessionArg(this.argv);
    const code = await runProfileCli(parsed.argv, parsed.sessionName);
    this.exitIfNeeded(code);
  }
}

class StatusTimelineCommand extends HarnessCommandBase {
  static override summary = 'Start or stop writing status timeline artifacts for a session.';

  static override usage = [
    'status-timeline [--session <name>] start [--output-path <path>]',
    'status-timeline [--session <name>] stop',
    'status-timeline [--session <name>] [--output-path <path>]',
  ];

  static override flags = {
    help: Flags.help({ char: 'h' }),
    session: sessionFlag,
  };

  override async run(): Promise<void> {
    const parsed = this.extractSessionArg(this.argv);
    const code = await runStatusTimelineCli(parsed.argv, parsed.sessionName);
    this.exitIfNeeded(code);
  }
}

class RenderTraceCommand extends HarnessCommandBase {
  static override summary = 'Start or stop render trace recording for a session.';

  static override usage = [
    'render-trace [--session <name>] start [--output-path <path>] [--conversation-id <id>]',
    'render-trace [--session <name>] stop',
    'render-trace [--session <name>] [--output-path <path>] [--conversation-id <id>]',
  ];

  static override flags = {
    help: Flags.help({ char: 'h' }),
    session: sessionFlag,
  };

  override async run(): Promise<void> {
    const parsed = this.extractSessionArg(this.argv);
    const code = await runRenderTraceCli(parsed.argv, parsed.sessionName);
    this.exitIfNeeded(code);
  }
}

class AuthCommand extends HarnessCommandBase {
  static override summary = 'Authenticate providers and manage saved credential state.';

  static override usage = [
    'auth login <github|linear> [options]',
    'auth logout <github|linear|all>',
    'auth status [--json]',
  ];

  static override flags = {
    help: Flags.help({ char: 'h' }),
    session: sessionFlag,
  };

  override async run(): Promise<void> {
    const parsed = this.extractSessionArg(this.argv);
    const code = await runAuthCli(parsed.argv, parsed.sessionName);
    this.exitIfNeeded(code);
  }
}

class UpdateCommand extends HarnessCommandBase {
  static override summary = 'Install the latest Harness package globally using Bun.';

  static override aliases = ['upgrade'];

  static override usage = ['update', 'upgrade'];

  static override flags = {
    help: Flags.help({ char: 'h' }),
    session: sessionFlag,
  };

  override async run(): Promise<void> {
    const parsed = this.extractSessionArg(this.argv);
    const code = runUpdateCli(parsed.argv, parsed.sessionName);
    this.exitIfNeeded(code);
  }
}

class CursorHooksCommand extends HarnessCommandBase {
  static override summary = 'Install or uninstall managed Cursor hooks.';

  static override usage = [
    'cursor-hooks [--session <name>] install [--hooks-file <path>]',
    'cursor-hooks [--session <name>] uninstall [--hooks-file <path>]',
  ];

  static override flags = {
    help: Flags.help({ char: 'h' }),
    session: sessionFlag,
  };

  override async run(): Promise<void> {
    const parsed = this.extractSessionArg(this.argv);
    const code = await runCursorHooksCli(parsed.argv, parsed.sessionName);
    this.exitIfNeeded(code);
  }
}

class AnimateCommand extends HarnessCommandBase {
  static override summary = 'Render the terminal animation benchmark scene.';

  static override usage = [
    'animate [--fps <fps>] [--frames <count>] [--duration-ms <ms>] [--seed <seed>] [--no-color]',
  ];

  static override flags = {
    help: Flags.help({ char: 'h' }),
    session: sessionFlag,
  };

  override async run(): Promise<void> {
    const parsed = this.extractSessionArg(this.argv);
    const code = await runAnimateCli(parsed.argv);
    this.exitIfNeeded(code);
  }
}

class NimCommand extends HarnessCommandBase {
  static override summary = 'Run Nim interactive TUI smoke/debug client.';

  static override usage = ['nim [options]'];

  static override flags = {
    help: Flags.help({ char: 'h' }),
    session: sessionFlag,
  };

  override async run(): Promise<void> {
    const parsed = this.extractSessionArg(this.argv);
    const code = await runNimCli(parsed.argv);
    this.exitIfNeeded(code);
  }
}

const commands = {
  client: ClientCommand,
  gateway: GatewayCommand,
  profile: ProfileCommand,
  'status-timeline': StatusTimelineCommand,
  'render-trace': RenderTraceCommand,
  auth: AuthCommand,
  update: UpdateCommand,
  'cursor-hooks': CursorHooksCommand,
  nim: NimCommand,
  animate: AnimateCommand,
} satisfies Record<string, Command.Class>;

export default commands;
