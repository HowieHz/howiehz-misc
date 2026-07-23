/** Keeps the temporary disabled reason first while preserving the control's existing hover guidance. */
export function prependControlTitle(reason: string | undefined, title: string | undefined) {
  if (!reason) {
    return title;
  }
  return title ? `${reason}\n${title}` : reason;
}
