/** How many results the title-bar dropdown shows, "See everything" aside. */
export const MAX_RESULTS = 9;
/** What your files and playlists keep once YouTube Music has answered. */
const LOCAL_SHARE = 5;

/**
 * Shares the dropdown's rows: `local` keeps up to its share and either side
 * takes what the other leaves. While YouTube Music is still being asked, local
 * rows stop at their share too, so its answer adds rows instead of moving them.
 */
export function fitResults<T>(local: T[], remote: T[], pending: boolean): T[] {
  if (pending && remote.length === 0) return local.slice(0, LOCAL_SHARE);
  const remoteRows = Math.min(
    remote.length,
    MAX_RESULTS - Math.min(local.length, LOCAL_SHARE),
  );
  return [
    ...local.slice(0, MAX_RESULTS - remoteRows),
    ...remote.slice(0, remoteRows),
  ];
}
