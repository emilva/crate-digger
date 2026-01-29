import { store, subscribe, setUser } from './store.js?v=16';
import { db } from './db.js?v=16';
import * as SCModule from './soundcloud.js?v=16';

console.log('Main.js loaded');
console.log('Imported SC Module:', SCModule);

const LocalSC = {
    initiateAuth: SCModule.initiateAuth,
    handleCallback: SCModule.handleCallback,
    getAccessToken: SCModule.getAccessToken,
    resolveUser: SCModule.resolveUser,
    getUserLikes: SCModule.getUserLikes,
    getUserReposts: SCModule.getUserReposts
};

console.log('Constructed LocalSC Object:', LocalSC);

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
const resetBtn = document.getElementById('reset-btn');
const sortSelect = document.getElementById('feed-sort');
const feedTitle = document.getElementById('feed-title');

// Initialization
async function init() {
    // Check auth status
    const token = await LocalSC.getAccessToken();
    if (token) {
        loginBtn.textContent = 'Connected';
        loginBtn.disabled = true;
    }
    
    // Always load cached data regardless of connection status
    loadData();

    // Auth Listener
    const authChannel = new BroadcastChannel('sc_auth_channel');
    authChannel.onmessage = async (event) => {
        if (event.data.type === 'oauth_code') {
            try {
                await LocalSC.handleCallback(event.data.code, event.data.state);
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
    if (typeof LocalSC.initiateAuth === 'function') {
        LocalSC.initiateAuth();
    } else {
        console.error('LocalSC.initiateAuth is not a function. SC object:', LocalSC);
        alert('Internal Error: SoundCloud auth function not loaded. Please refresh.');
    }
});

syncAllBtn.addEventListener('click', () => {
    syncAll();
});

addBtn.addEventListener('click', () => {
    addModal.showModal();
});

resetBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all discovered tracks? Your tastemaker list will be preserved.')) {
        await db.activities.clear();
        await db.tracks.clear();
        
        // Reset lastSynced for all tastemakers
        const tms = await db.tastemakers.toArray();
        for (const tm of tms) {
            await db.tastemakers.update(tm.id, { lastSynced: 0, newCount: 0 });
        }
        
        window.location.reload();
    }
});

sortSelect.addEventListener('change', () => {
    renderFeed();
});

feedTitle.addEventListener('click', () => {
    document.querySelectorAll('.tastemaker-item').forEach(el => el.classList.remove('active'));
    renderFeed(); // No ID = All
});


confirmAddBtn.addEventListener('click', async (e) => {
    e.preventDefault(); // Handle form manually
    const input = tastemakerInput.value.trim();
    if (!input) return;

    try {
        // Resolve user
        const user = await LocalSC.resolveUser(input);
        
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
        const [likes, reposts] = await Promise.all([
            LocalSC.getUserLikes(tm.soundcloudId),
            LocalSC.getUserReposts(tm.soundcloudId)
        ]);

        const allActivity = [...likes, ...reposts];
        let newItemsCount = 0;
        
        // The API returns items sorted by "Newest Liked First".
        // We want to preserve this order in our feed (which sorts by discoveredAt desc).
        // So we assign timestamps: Now, Now-1s, Now-2s... 
        const baseTime = Date.now();

        // Iterate with index to calculate relative time
        for (let i = 0; i < allActivity.length; i++) {
            const item = allActivity[i];
            
            // Upsert track
            let trackId;
            // V1 API returns 'id', V2 uses 'id' inside track object. 
            // Our SC helper normalizes this, but let's be safe.
            const scId = item.id || item.track?.id;
            
            const existingTrack = await db.tracks.where('soundcloudId').equals(scId).first();
            
            if (existingTrack) {
                trackId = existingTrack.id;
            } else {
                trackId = await db.tracks.add({
                    soundcloudId: scId,
                    soundcloudUrl: item.permalink_url || item.track?.permalink_url,
                    title: item.title || item.track?.title,
                    artist: item.user?.username || item.track?.user?.username,
                    addedAt: new Date().toISOString(),
                    uploadDate: item.created_at // Save real release date
                });
            }

            // Check if activity already exists
            const existingActivity = await db.activities
                .where('[tasteMakerId+trackId+type]')
                .equals([tm.id, trackId, item.type])
                .first();

            if (!existingActivity) {
                // Fix: Use Sync Time - Index to preserve API order
                // item.created_at is Track Upload Date (wrong for sorting likes)
                const inferredTime = new Date(baseTime - (i * 1000)).toISOString();
                
                await db.activities.add({
                    tasteMakerId: tm.id,
                    trackId: trackId,
                    type: item.type,
                    discoveredAt: inferredTime
                });
                newItemsCount++;
            }
        }

        // Update with new count accumulation
        const currentTm = await db.tastemakers.get(tmId);
        const previousCount = currentTm.newCount || 0;

        await db.tastemakers.update(tmId, { 
            lastSynced: new Date().toISOString(),
            newCount: previousCount + newItemsCount
        });
        
        console.log(`Synced ${tm.username}: ${newItemsCount} new items`);
        renderFeed();
        renderTastemakers();
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
    tastemakerList.innerHTML = list.map(tm => {
        const badge = tm.newCount > 0 ? `<span class="tm-badge">+${tm.newCount}</span>` : '';
        return `
        <div class="tastemaker-item" data-id="${tm.id}">
            <div class="tm-info" onclick="filterFeed(${tm.id})">
                <span class="tm-name">${tm.username} ${badge}</span>
                <span class="tm-meta">Last sync: ${tm.lastSynced ? new Date(tm.lastSynced).toLocaleDateString() : 'Never'}</span>
            </div>
            <button class="sync-tm-btn" data-id="${tm.id}">🔄</button>
        </div>
        `;
    }).join('');

    // Add listeners to individual sync buttons
    document.querySelectorAll('.sync-tm-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            syncTastemaker(parseInt(btn.dataset.id));
        });
    });

    // Add listeners to rows for filtering
    document.querySelectorAll('.tastemaker-item').forEach(item => {
        item.addEventListener('click', () => {
            // Remove active class from all
            document.querySelectorAll('.tastemaker-item').forEach(el => el.classList.remove('active'));
            // Add to current
            item.classList.add('active');
            
            renderFeed(parseInt(item.dataset.id));
        });
    });
}

async function renderFeed(filterTmId = null) {
    // Fetch all needed data first
    let activities = await db.activities.toArray();
    
    // Filter if requested
    if (filterTmId) {
        activities = activities.filter(act => act.tasteMakerId === filterTmId);
    }

    const tracks = await db.tracks.toArray();
    const tms = await db.tastemakers.toArray();
    
    const trackMap = new Map(tracks.map(t => [t.id, t]));
    const tmMap = new Map(tms.map(tm => [tm.id, tm]));

    // Enrich activities so we can sort them
    const enrichedFeed = activities.map(act => {
        const track = trackMap.get(act.trackId);
        const tm = tmMap.get(act.tasteMakerId);
        if (!track || !tm) return null;
        
        return { ...act, track, tm };
    }).filter(item => item !== null);

    // Sort based on selection
    const sortBy = sortSelect.value; // 'discovered' or 'released'
    
    enrichedFeed.sort((a, b) => {
        if (sortBy === 'released') {
            // Sort by Track Upload Date (Newest First)
            const dateA = new Date(a.track.uploadDate || 0);
            const dateB = new Date(b.track.uploadDate || 0);
            return dateB - dateA;
        } else {
            // Sort by Discovery Date (Newest First) - Default
            const dateA = new Date(a.discoveredAt || 0);
            const dateB = new Date(b.discoveredAt || 0);
            return dateB - dateA;
        }
    });

    if (enrichedFeed.length === 0) {
        feedList.innerHTML = '<div class="empty-state">No tracks discovered yet. Add a tastemaker and sync!</div>';
        return;
    }

    feedList.innerHTML = enrichedFeed.map(item => {
        const { track, tm } = item;

        return `
            <div class="track-card">
                <div class="track-art-placeholder">
                    <i class="ph ph-vinyl-record"></i>
                </div>
                <div class="track-info">
                    <span class="title">${track.title}</span>
                    <span class="artist">${track.artist}</span>
                    <span class="activity">
                        ${act.type === 'like' ? '<i class="ph ph-heart"></i> LIKED' : '<i class="ph ph-arrows-left-right"></i> REPOST'} 
                        BY ${tm.username}
                    </span>
                </div>
                <div class="track-actions">
                    <button class="play-btn" data-url="${track.soundcloudUrl}">PLAY</button>
                    <a href="${track.soundcloudUrl}" target="_blank" class="sc-link" style="color:var(--text-dim); text-decoration:none; font-size:0.8rem; margin-left:8px;">SC ↗</a>
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
        // Use window.SC explicitly to avoid any confusion with local variables
        const widget = window.SC.Widget(widgetElement);
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