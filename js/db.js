import Dexie from 'https://unpkg.com/dexie@latest/dist/dexie.mjs';

export const db = new Dexie('TastemakerDB');

db.version(1).stores({
    tastemakers: '++id, &soundcloudId, username, lastSynced',
    tracks: '++id, &soundcloudId, soundcloudUrl, title, artist, addedAt',
    activities: '++id, tasteMakerId, trackId, type, discoveredAt',
    bookmarks: '++id, trackId, addedAt',
    auth: 'key'
});

db.version(2).stores({
    activities: '++id, tasteMakerId, trackId, type, [tasteMakerId+trackId+type], discoveredAt'
});

// V3: Add likedAt index for sorting by when tracks were actually liked
db.version(3).stores({
    activities: '++id, tasteMakerId, trackId, type, [tasteMakerId+trackId+type], discoveredAt, likedAt'
});

export async function clearAllData() {
    await db.delete();
    await db.open();
}
