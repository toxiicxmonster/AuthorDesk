/** Whether AuthorDesk is running as the desktop app (its own window) rather than in a web browser. */
export const isDesktopApp = typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent);

/** Where the books are kept, for sentences like "Your work lives only in ___". */
export const storagePlace = isDesktopApp ? 'AuthorDesk on this computer' : 'this browser';
