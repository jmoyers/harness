import { readCliValue } from './flags.ts';

const SESSION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

interface ParsedGlobalCliOptions {
  readonly sessionName: string | null;
  readonly argv: readonly string[];
}

export class SessionCliParser {
  public constructor() {}

  public parseSessionName(rawValue: string): string {
    const trimmed = rawValue.trim();
    if (!SESSION_NAME_PATTERN.test(trimmed)) {
      throw new Error(`invalid --session value: ${rawValue}`);
    }
    return trimmed;
  }

  public parseGlobalCliOptions(argv: readonly string[]): ParsedGlobalCliOptions {
    if (argv.length < 2 || argv[0] !== '--session') {
      return {
        sessionName: null,
        argv,
      };
    }
    const sessionName = this.parseSessionName(readCliValue(argv, 0, '--session'));
    return {
      sessionName,
      argv: argv.slice(2),
    };
  }
}

export function parseSessionName(rawValue: string): string {
  return new SessionCliParser().parseSessionName(rawValue);
}

export function parseGlobalCliOptions(argv: readonly string[]): ParsedGlobalCliOptions {
  return new SessionCliParser().parseGlobalCliOptions(argv);
}
