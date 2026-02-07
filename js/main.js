import { store, subscribe } from './store.js?v=31';
import { db } from './db.js?v=31';
import * as SCModule from './soundcloud.js?v=31';

const LocalSC = {
    initiateAuth: SCModule.initiateAuth,
    handleCallback: SCModule.handleCallback,
    getAccessToken: SCModule.getAccessToken,
    resolveUser: SCModule.resolveUser,
    getUserLikes: SCModule.getUserLikes,
    getUserReposts: SCModule.getUserReposts
};

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

// Helpers
function timeAgo(dateStr) {
    if (!dateStr) return '';
    const seconds = Math.floor((Date.now() - new Date(dateStr)) / 1000);
    if (seconds < 0) return 'just now';
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 604800)}w ago`;
    return new Date(dateStr).toLocaleDateString();
}

// Initialization
async function init() {
    const token = await LocalSC.getAccessToken();
    if (token) {
        loginBtn.textContent = 'Connected';
        loginBtn.disabled = true;
    }

    loadData();

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
        alert('Internal Error: SoundCloud auth function not loaded. Please refresh.');
    }
});

syncAllBtn.addEventListener('click', () => syncAll());

addBtn.addEventListener('click', () => addModal.showModal());

resetBtn.addEventListener('click', async () => {
    if (confirm('Clear all discovered tracks? Your tastemaker list will be preserved.')) {
        await db.activities.clear();
        await db.tracks.clear();

        const tms = await db.tastemakers.toArray();
        for (const tm of tms) {
            await db.tastemakers.update(tm.id, { lastSynced: 0, lastViewedAt: null });
        }

        window.location.reload();
    }
});

sortSelect.addEventListener('change', () => renderFeed());

feedTitle.addEventListener('click', () => {
    document.querySelectorAll('.tastemaker-item').forEach(el => el.classList.remove('active'));
    renderFeed();
});

confirmAddBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    const input = tastemakerInput.value.trim();
    if (!input) return;

    try {
        const user = await LocalSC.resolveUser(input);

        await db.tastemakers.add({
            soundcloudId: user.id,
            username: user.username,
            avatarUrl: user.avatar_url,
            lastSynced: 0,
            lastViewedAt: null
        });

        tastemakerInput.value = '';
        addModal.close();
        renderTastemakers();
    } catch (err) {
        alert('Could not find user: ' + err.message);
    }
});

// Sync
async function syncTastemaker(tmId) {
    const tm = await db.tastemakers.get(tmId);
    if (!tm) return;

    store.loading = true;
    try {
        const likes = await LocalSC.getUserLikes(tm.soundcloudId);
        let newItemsCount = 0;

        // API returns most-recently-liked first. Assign descending timestamps
        // so discoveredAt preserves that order for sorting.
        const baseTime = Date.now();

        for (let i = 0; i < likes.length; i++) {
            const item = likes[i];

            let trackId;
            const scId = item.id;

            const existingTrack = await db.tracks.where('soundcloudId').equals(scId).first();

            if (existingTrack) {
                trackId = existingTrack.id;
            } else {
                trackId = await db.tracks.add({
                    soundcloudId: scId,
                    soundcloudUrl: item.permalink_url,
                    title: item.title,
                    artist: item.user?.username,
                    artworkUrl: item.artwork_url,
                    addedAt: new Date().toISOString(),
                    uploadDate: item.created_at
                });
            }

            const existingActivity = await db.activities
                .where('[tasteMakerId+trackId+type]')
                .equals([tm.id, trackId, item.type])
                .first();

            if (!existingActivity) {
                await db.activities.add({
                    tasteMakerId: tm.id,
                    trackId: trackId,
                    type: item.type,
                    discoveredAt: new Date(baseTime - (i * 1000)).toISOString()
                });
                newItemsCount++;
            }
        }

        await db.tastemakers.update(tmId, {
            lastSynced: new Date().toISOString()
        });

        console.log(`Synced ${tm.username}: ${newItemsCount} new items (${likes.length} total from API)`);
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
    const allActivities = await db.activities.toArray();

    tastemakerList.innerHTML = list.map(tm => {
        // Compute new count: activities discovered after lastViewedAt
        const lastViewed = tm.lastViewedAt ? new Date(tm.lastViewedAt).getTime() : 0;
        const newCount = allActivities.filter(a =>
            a.tasteMakerId === tm.id &&
            new Date(a.discoveredAt).getTime() > lastViewed
        ).length;

        const badge = newCount > 0 ? `<span class="tm-badge">+${newCount}</span>` : '';
        const syncDate = tm.lastSynced && tm.lastSynced !== 0
            ? timeAgo(tm.lastSynced)
            : 'Never';

        return `
        <div class="tastemaker-item" data-id="${tm.id}">
            <div class="tm-info">
                <span class="tm-name">${tm.username} ${badge}</span>
                <span class="tm-meta">Synced ${syncDate}</span>
            </div>
            <button class="sync-tm-btn" data-id="${tm.id}">🔄</button>
        </div>
        `;
    }).join('');

    // Sync button listeners
    document.querySelectorAll('.sync-tm-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            syncTastemaker(parseInt(btn.dataset.id));
        });
    });

    // Row click: filter feed + mark as viewed
    document.querySelectorAll('.tastemaker-item').forEach(item => {
        item.addEventListener('click', async () => {
            document.querySelectorAll('.tastemaker-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');

            const tmId = parseInt(item.dataset.id);

            // Mark as viewed - clears the "new" badge
            await db.tastemakers.update(tmId, {
                lastViewedAt: new Date().toISOString()
            });

            renderFeed(tmId);
            renderTastemakers();
        });
    });
}

async function renderFeed(filterTmId = null) {
    let activities = await db.activities.toArray();

    if (filterTmId) {
        activities = activities.filter(act => act.tasteMakerId === filterTmId);
    }

    const tracks = await db.tracks.toArray();
    const tms = await db.tastemakers.toArray();

    const trackMap = new Map(tracks.map(t => [t.id, t]));
    const tmMap = new Map(tms.map(tm => [tm.id, tm]));

    const enrichedFeed = activities.map(act => {
        const track = trackMap.get(act.trackId);
        const tm = tmMap.get(act.tasteMakerId);
        if (!track || !tm) return null;
        return { ...act, track, tm };
    }).filter(item => item !== null);

    // Sort
    const sortBy = sortSelect.value;

    enrichedFeed.sort((a, b) => {
        if (sortBy === 'released') {
            return new Date(b.track.uploadDate || 0) - new Date(a.track.uploadDate || 0);
        } else {
            // Default: sort by discoveredAt (preserves API's most-recently-liked order)
            return new Date(b.discoveredAt || 0) - new Date(a.discoveredAt || 0);
        }
    });

    if (enrichedFeed.length === 0) {
        feedList.innerHTML = '<div class="empty-state">No tracks discovered yet. Add a tastemaker and sync!</div>';
        return;
    }

    feedList.innerHTML = enrichedFeed.map(item => {
        const { track, tm } = item;

        const artworkHtml = track.artworkUrl
            ? `<img src="${track.artworkUrl.replace('-large', '-t200x200')}" alt="" class="track-art" loading="lazy">`
            : `<div class="track-art-placeholder"><i class="ph-fill ph-disc"></i></div>`;

        return `
            <div class="track-card">
                ${artworkHtml}
                <div class="track-info">
                    <span class="title">${track.title || 'Untitled'}</span>
                    <span class="artist">${track.artist || 'Unknown'}</span>
                    <span class="activity">
                        ${item.type === 'like' ? '<i class="ph ph-heart"></i> LIKED' : '<i class="ph ph-arrows-left-right"></i> REPOST'}
                        BY ${tm.username}
                    </span>
                </div>
                <div class="track-actions">
                    <button class="play-btn" data-url="${track.soundcloudUrl}">PLAY</button>
                    <a href="${track.soundcloudUrl}" target="_blank" class="sc-link">SC ↗</a>
                    <button class="dismiss-btn icon-btn" data-id="${item.id}" title="Dismiss"><i class="ph ph-x"></i></button>
                </div>
            </div>
        `;
    }).join('');

    // Play listeners
    document.querySelectorAll('.play-btn').forEach(btn => {
        btn.addEventListener('click', () => playTrack(btn.dataset.url));
    });

    // Dismiss listeners
    document.querySelectorAll('.dismiss-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const activityId = parseInt(btn.dataset.id);

            const card = btn.closest('.track-card');
            card.style.transition = 'opacity 0.2s, transform 0.2s';
            card.style.opacity = '0';
            card.style.transform = 'scale(0.95)';

            setTimeout(() => card.remove(), 200);

            await db.activities.delete(activityId);
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
        const widget = window.SC.Widget(widgetElement);
        widget.load(url, { auto_play: true });
    }
}

async function loadData() {
    renderTastemakers();
    renderFeed();
}

subscribe(() => {});

init();
