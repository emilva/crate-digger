import Dexie from 'https://unpkg.com/dexie@latest/dist/dexie.mjs';

export const db = new Dexie('TastemakerDB');

db.version(1).stores({
    tastemakers: '++id, &soundcloudId, username, lastSynced',
    tracks: '++id, &soundcloudId, soundcloudUrl, title, artist, addedAt',
    activities: '++id, tasteMakerId, trackId, type, discoveredAt',
    bookmarks: '++id, trackId, addedAt',
    auth: 'key' // Single row for storing tokens: { key: 'tokens', ... }
});

export async function clearAllData() {
    await db.delete();
    await db.open();
}
