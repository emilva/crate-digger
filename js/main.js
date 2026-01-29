import { store, subscribe, setUser } from './store.js';
import { db } from './db.js';
import * as SC from './soundcloud.js';

// DOM Elements
const loginBtn = document.getElementById('login-btn');
const addBtn = document.getElementById('add-tastemaker-btn');
const addModal = document.getElementById('add-tastemaker-modal');
const confirmAddBtn = document.getElementById('confirm-add-btn');
const tastemakerInput = document.getElementById('tastemaker-input');
const tastemakerList = document.getElementById('tastemakers-list');
const feedList = document.getElementById('feed-list');
const playerContainer = document.getElementById('player-container');

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
    SC.initiateAuth();
});

addBtn.addEventListener('click', () => {
    addModal.showModal();
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

// Rendering
async function renderTastemakers() {
    const list = await db.tastemakers.toArray();
    tastemakerList.innerHTML = list.map(tm => `
        <div class="tastemaker-item" data-id="${tm.id}">
            <span>${tm.username}</span>
        </div>
    `).join('');
}

async function loadData() {
    renderTastemakers();
    // Load feed...
}

// Store subscriptions
subscribe(state => {
    // React to state changes if needed
});

// Start
init();
