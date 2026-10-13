/**
 * Builds the shell command line that opens a path (optionally at a line) in an
 * editor CLI such as `code`. The command runs through the platform shell, so every
 * part is quoted; Windows entry names cannot contain `"`, POSIX quoting escapes `'`.
 */
export function buildEditorCommand(
  command: string,
  path: string,
  line: number | undefined,
  platform: string
): string {
  const args = line === undefined ? [path] : ['--goto', `${path}:${line}`]
  return [command, ...args].map((part) => quote(part, platform)).join(' ')
}

function quote(value: string, platform: string): string {
  if (platform === 'win32') return `"${value}"`
  return `'${value.replace(/'/g, `'\\''`)}'`
}
