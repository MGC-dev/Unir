// Uploaded files only exist in memory for the current session (the mock backend stores their details, not the bytes).
// With a real backend, `rememberFile` becomes an upload and `fileUrl` returns the download link.
const urls = new Map<string, string>()
/** Live mode: uploads the file to the firm's private storage bucket (set by api/remote.ts). */
export const fileHooks: { upload?: (docId: string, file: File) => void } = {}
export const rememberFile = (docId: string, file: File) => { urls.set(docId, URL.createObjectURL(file)); fileHooks.upload?.(docId, file) }
/** Live mode: a short-lived download link for a stored file. */
export const setFileUrl = (docId: string, url: string) => { urls.set(docId, url) }
export const fileUrl = (docId: string): string | undefined => urls.get(docId)

export const formatSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
