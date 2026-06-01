// localStorage-backed persistence for the working document. Isolated in its own
// module so the rest of the app has a single seam for "where the doc lives" and
// the impure storage access stays out of the pure model/render code. The stored
// payload is the same serialized world-file text the export/import path uses, so
// persistence and file I/O can never drift apart in format.

const STORAGE_KEY = 'poincake:world';

export const loadPersistedWorld = (): string | null => {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    // Storage can be unavailable (private mode, disabled cookies); treat that as
    // "nothing persisted" rather than failing the whole boot.
    console.warn('Could not read the persisted document; starting fresh.', error);
    return null;
  }
};

export const savePersistedWorld = (text: string): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, text);
  } catch (error) {
    // Most likely a quota overflow (e.g. large embedded images); the in-memory
    // document is still intact, so we only warn.
    console.warn('Could not persist the document.', error);
  }
};

export const clearPersistedWorld = (): void => {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Could not clear the persisted document.', error);
  }
};
