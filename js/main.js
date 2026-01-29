import { store, subscribe, setUser } from './store.js?v=3';
import { db } from './db.js?v=3';
import * as SCModule from './soundcloud.js?v=3';

console.log('Main.js loaded');
console.log('Imported SC Module:', SCModule);

const SC = {
    initiateAuth: SCModule.initiateAuth,
    handleCallback: SCModule.handleCallback,
    getAccessToken: SCModule.getAccessToken,
    resolveUser: SCModule.resolveUser,
    getUserLikes: SCModule.getUserLikes,
    getUserReposts: SCModule.getUserReposts
};

console.log('Constructed SC Object:', SC);

// DOM Elements
const loginBtn = document.getElementById('login-btn');
const addBtn = document.getElementById('add-tastemaker-btn');
const addModal = document.getElementById('add-tastemaker-modal');
const confirmAddBtn = document.getElementById('confirm-add-btn');
const tastemakerInput = document.getElementById('tastemaker-input');
const tastemakerList = document.getElementById('tastemakers-list');
const feedList = document.getElementById('feed-list');
const playerContainer = document.getElementById('player-container');

const syncAllBtn = document.getElementById('sync-all-btn');
const demoBtn = document.getElementById('demo-btn');

// Initialization
async function init() {
    // Check auth status
    const token = await SC.getAccessToken();
    if (token) {
        loginBtn.textContent = 'Connected';
        loginBtn.disabled = true;
        loadData();
    }

    // Auth Listener
    const authChannel = new BroadcastChannel('sc_auth_channel');
    authChannel.onmessage = async (event) => {
        if (event.data.type === 'oauth_code') {
            try {
                await SC.handleCallback(event.data.code, event.data.state);
                loginBtn.textContent = 'Connected';
                loginBtn.disabled = true;
                loadData();
            } catch (err) {
                console.error('Auth failed', err);
                alert('Authentication failed: ' + err.message);
            }
        }
    };
}

// Event Listeners
loginBtn.addEventListener('click', () => {
    if (typeof SC.initiateAuth === 'function') {
        SC.initiateAuth();
    } else {
        console.error('SC.initiateAuth is not a function. SC object:', SC);
        alert('Internal Error: SoundCloud auth function not loaded. Please refresh.');
    }
});

syncAllBtn.addEventListener('click', () => {
    syncAll();
});

addBtn.addEventListener('click', () => {
    addModal.showModal();
});

demoBtn.addEventListener('click', () => {
    loadDemoData();
});

confirmAddBtn.addEventListener('click', async (e) => {
    e.preventDefault(); // Handle form manually
    const input = tastemakerInput.value.trim();
    if (!input) return;

    try {
        // Resolve user
        const user = await SC.resolveUser(input);
        
        // Add to DB
        await db.tastemakers.add({
            soundcloudId: user.id,
            username: user.username,
            avatarUrl: user.avatar_url,
            lastSynced: 0
        });

        tastemakerInput.value = '';
        addModal.close();
        renderTastemakers();
    } catch (err) {
        alert('Could not find user: ' + err.message);
    }
});

// Actions
async function loadDemoData() {
    console.log('Loading demo data...');
    const demoTms = [
        { id: 'tm1', soundcloudId: 1, username: 'DJ Python', avatarUrl: '' },
        { id: 'tm2', soundcloudId: 2, username: 'Ninja Tune', avatarUrl: '' },
        { id: 'tm3', soundcloudId: 3, username: 'Lobster Theremin', avatarUrl: '' }
    ];

    for (const tm of demoTms) {
        await db.tastemakers.put({ ...tm, lastSynced: new Date().toISOString() });
    }

    const demoTracks = [
        { soundcloudId: 101, title: 'Angel', artist: 'DJ Python', soundcloudUrl: 'https://soundcloud.com/dj-python/angel' },
        { soundcloudId: 102, title: 'Never See You Again', artist: 'Logic1000', soundcloudUrl: 'https://soundcloud.com/logic1000/never-see-you-again' },
        { soundcloudId: 103, title: 'Braid', artist: 'Hessle Audio', soundcloudUrl: 'https://soundcloud.com/hessle-audio/braid' }
    ];

    for (const track of demoTracks) {
        const trackId = await db.tracks.put({ ...track, addedAt: new Date().toISOString() });
        
        // Link to activities
        await db.activities.put({
            tasteMakerId: 'tm1',
            trackId: trackId,
            type: 'like',
            discoveredAt: new Date().toISOString()
        });
    }

    renderTastemakers();
    renderFeed();
    alert('Demo data loaded!');
}

async function syncTastemaker(tmId) {
    const tm = await db.tastemakers.get(tmId);
    if (!tm) return;

    store.loading = true;
    try {
        const [likes] = await Promise.all([
            SC.getUserLikes(tm.soundcloudId),
            // SC.getUserReposts(tm.soundcloudId) // Disable reposts for now
        ]);

        const allActivity = [...likes]; //, ...reposts];
        let newItemsCount = 0;

        for (const item of allActivity) {
            // Upsert track
            let trackId;
            const existingTrack = await db.tracks.where('soundcloudId').equals(item.id).first();
            
            if (existingTrack) {
                trackId = existingTrack.id;
            } else {
                trackId = await db.tracks.add({
                    soundcloudId: item.id,
                    soundcloudUrl: item.permalink_url,
                    title: item.title,
                    artist: item.user.username,
                    addedAt: new Date().toISOString()
                });
            }

            // Check if activity already exists
            const existingActivity = await db.activities
                .where('[tasteMakerId+trackId+type]')
                .equals([tm.id, trackId, item.type])
                .first();

            if (!existingActivity) {
                await db.activities.add({
                    tasteMakerId: tm.id,
                    trackId: trackId,
                    type: item.type,
                    discoveredAt: item.created_at || new Date().toISOString()
                });
                newItemsCount++;
            }
        }

        await db.tastemakers.update(tmId, { lastSynced: new Date().toISOString() });
        console.log(`Synced ${tm.username}: ${newItemsCount} new items`);
        renderFeed();
    } catch (err) {
        console.error(`Failed to sync ${tm.username}`, err);
    } finally {
        store.loading = false;
    }
}

async function syncAll() {
    const tms = await db.tastemakers.toArray();
    for (const tm of tms) {
        await syncTastemaker(tm.id);
    }
}

// Rendering
async function renderTastemakers() {
    const list = await db.tastemakers.toArray();
    tastemakerList.innerHTML = list.map(tm => `
        <div class="tastemaker-item" data-id="${tm.id}">
            <div class="tm-info">
                <span class="tm-name">${tm.username}</span>
                <span class="tm-meta">Last sync: ${tm.lastSynced ? new Date(tm.lastSynced).toLocaleDateString() : 'Never'}</span>
            </div>
            <button class="sync-tm-btn" data-id="${tm.id}">🔄</button>
        </div>
    `).join('');

    // Add listeners to individual sync buttons
    document.querySelectorAll('.sync-tm-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            syncTastemaker(parseInt(btn.dataset.id));
        });
    });
}

async function renderFeed() {
    // Get all activities sorted by date
    const activities = await db.activities.orderBy('discoveredAt').reverse().toArray();
    if (activities.length === 0) {
        feedList.innerHTML = '<div class="empty-state">No tracks discovered yet. Add a tastemaker and sync!</div>';
        return;
    }

    // Fetch tracks and tastemakers for enrichment
    const tracks = await db.tracks.toArray();
    const tms = await db.tastemakers.toArray();
    
    const trackMap = new Map(tracks.map(t => [t.id, t]));
    const tmMap = new Map(tms.map(tm => [tm.id, tm]));

    feedList.innerHTML = activities.map(act => {
        const track = trackMap.get(act.trackId);
        const tm = tmMap.get(act.tasteMakerId);
        if (!track || !tm) return '';

        return `
            <div class="track-card">
                <div class="track-info">
                    <span class="title">${track.title}</span>
                    <span class="artist">${track.artist}</span>
                    <span class="activity">${act.type === 'like' ? '❤️ Liked' : '🔁 Reposted'} by ${tm.username}</span>
                </div>
                <div class="track-actions">
                    <button class="play-btn" data-url="${track.soundcloudUrl}">Play</button>
                    <a href="${track.soundcloudUrl}" target="_blank" class="sc-link">View on SC</a>
                </div>
            </div>
        `;
    }).join('');

    // Add play listeners
    document.querySelectorAll('.play-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const url = btn.dataset.url;
            playTrack(url);
        });
    });
}

function playTrack(url) {
    const widgetElement = document.getElementById('sc-widget');
    if (!widgetElement) {
        playerContainer.innerHTML = `
            <iframe id="sc-widget" width="100%" height="166" scrolling="no" frameborder="no" allow="autoplay"
                src="https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=true">
            </iframe>
        `;
    } else {
        const widget = SC.Widget(widgetElement);
        widget.load(url, { auto_play: true });
    }
}

// Update db schema to support the composite key we used
db.version(2).stores({
    activities: '++id, tasteMakerId, trackId, type, [tasteMakerId+trackId+type], discoveredAt'
});

async function loadData() {
    renderTastemakers();
    renderFeed();
}

// Store subscriptions
subscribe(state => {
    // React to state changes if needed
});

// Start
init();