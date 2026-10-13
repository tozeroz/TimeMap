import type { ImageText } from '../native/imageText'

export interface PublishDraft {
  id: string
  text: string
  original: string
  placeId: string
  stickerRequested: boolean
  updatedAt: number
  imageText?: ImageText
  pendingSubmission?: { body: string; placeId: string; mediaIds: string[]; mapMediaId?: string; imageMode: 'photo' | 'sticker'; clientRequestId: string }
}

// IndexedDB keeps actual image data, rather than a temporary object URL.
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('timemap-publish', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('drafts', { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function draftOperation<T>(action: (store: IDBObjectStore) => IDBRequest<T>, write = false): Promise<T> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', write ? 'readwrite' : 'readonly')
    const req = action(tx.objectStore('drafts'))
    tx.oncomplete = () => { db.close(); resolve(req.result) }
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error) }
  })
}

export const listDrafts = () => draftOperation<PublishDraft[]>((s) => s.getAll())
export const saveDraft = (draft: PublishDraft) => draftOperation((s) => s.put(draft), true)
export const deleteDraft = (id: string) => draftOperation((s) => s.delete(id), true)
