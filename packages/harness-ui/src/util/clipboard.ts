import { platform } from 'node:os';
import { spawn } from 'node:child_process';

function writeOsc52(text: string): void {
  if (!process.stdout.isTTY) return;
  const base64 = Buffer.from(text).toString('base64');
  const osc52 = `\x1b]52;c;${base64}\x07`;
  const passthrough = process.env['TMUX'] !== undefined || process.env['STY'] !== undefined;
  const sequence = passthrough ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52;
  process.stdout.write(sequence);
}

type CopyFn = (text: string) => Promise<void>;

function writeTextToCommand(command: string, args: readonly string[], text: string): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn(command, [...args], {
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    proc.once('error', () => {
      resolve();
    });
    proc.once('close', () => {
      resolve();
    });
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

function readTextFromCommand(command: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(command, [...args], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const chunks: Buffer[] = [];
    proc.once('error', () => {
      resolve(null);
    });
    proc.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    proc.once('close', (code) => {
      if (typeof code === 'number' && code !== 0) {
        resolve(null);
        return;
      }
      const text = Buffer.concat(chunks).toString('utf8');
      resolve(text.length > 0 ? text : null);
    });
  });
}

function detectCopyMethod(): CopyFn {
  const os = platform();

  if (os === 'darwin') {
    return async (text: string) => await writeTextToCommand('pbcopy', [], text);
  }

  if (os === 'linux') {
    if (process.env['WAYLAND_DISPLAY'] !== undefined) {
      return async (text: string) => await writeTextToCommand('wl-copy', [], text);
    }
    return async (text: string) =>
      await writeTextToCommand('xclip', ['-selection', 'clipboard'], text);
  }

  if (os === 'win32') {
    return async (text: string) =>
      await writeTextToCommand(
        'powershell.exe',
        [
          '-NonInteractive',
          '-NoProfile',
          '-Command',
          '[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())',
        ],
        text,
      );
  }

  return async () => {};
}

let cachedCopy: CopyFn | null = null;

export async function copyToClipboard(text: string): Promise<void> {
  writeOsc52(text);
  if (cachedCopy === null) cachedCopy = detectCopyMethod();
  await cachedCopy(text);
}

export async function readClipboardText(): Promise<string | null> {
  const os = platform();
  try {
    if (os === 'darwin') {
      return await readTextFromCommand('pbpaste', []);
    }
    if (os === 'linux') {
      if (process.env['WAYLAND_DISPLAY'] !== undefined) {
        return await readTextFromCommand('wl-paste', ['-n']);
      }
      return await readTextFromCommand('xclip', ['-selection', 'clipboard', '-o']);
    }
  } catch {
    return null;
  }
  return null;
}
