import type { ChangeKind } from '@gitreedesk/shared'

/** Single-letter status marker shown in front of a changed path. */
export const CHANGE_LETTER: Record<ChangeKind, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typeChanged: 'T'
}
