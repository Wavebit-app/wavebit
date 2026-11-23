/** Whether an iframe report belongs to the video the app currently requested. */
export function isRequestedVideo(
  reported: string | null,
  requested: string | null,
): boolean {
  return requested !== null && reported === requested;
}
