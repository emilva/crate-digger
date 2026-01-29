import { db } from './db.js';

// TODO: Replace with your actual Client ID
const CLIENT_ID = 'OvQ9pSBM9BAErgRohwPy83moZt2GL5vJ'; 

// Construct the redirect URI dynamically
const REDIRECT_URI = (() => {
    const url = new URL(window.location.href);
    const pathParts = url.pathname.split('/');
    if (pathParts[1] === 'crate-digger') {
        return `${url.origin}/crate-digger/callback.html`;
    }
    return `${url.origin}/callback.html`;
})();

// PKCE Helpers
function generateRandomString(length) {
    const array = new Uint8Array(length);
    window.crypto.getRandomValues(array);
    return Array.from(array, dec => ('0' + dec.toString(16)).substr(-2)).join('');
}

async function sha256(plain) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return window.crypto.subtle.digest('SHA-256', data);
}

function base64UrlEncode(a) {
    let str = "";
    const bytes = new Uint8Array(a);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        str += String.fromCharCode(bytes[i]);
    }
    return btoa(str)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

async function generateCodeChallenge(v) {
    const hashed = await sha256(v);
    return base64UrlEncode(hashed);
}

export async function initiateAuth() {
    const verifier = generateRandomString(64);
    const challenge = await generateCodeChallenge(verifier);
    const state = generateRandomString(16);

    // Store verifier in sessionStorage (short-lived)
    sessionStorage.setItem('sc_verifier', verifier);
    sessionStorage.setItem('sc_state', state);

    const authUrl = new URL('https://secure.soundcloud.com/authorize');
    authUrl.searchParams.append('client_id', CLIENT_ID);
    authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('code_challenge', challenge);
    authUrl.searchParams.append('code_challenge_method', 'S256');
    authUrl.searchParams.append('state', state);

    // Open popup
    window.open(authUrl.toString(), 'sc_auth', 'width=500,height=700');
}

export async function handleCallback(code, state) {
    const savedState = sessionStorage.getItem('sc_state');
    const verifier = sessionStorage.getItem('sc_verifier');

    if (state !== savedState) {
        throw new Error('State mismatch');
    }

    // Exchange code for token (Pure PKCE - No Secret)
    const params = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
        code: code
    });

    const response = await fetch('https://secure.soundcloud.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error_description || 'Token exchange failed. Ensure your app is Public or use a backend.');
    }

    const tokens = await response.json();
    await saveTokens(tokens);
    return tokens;
}

async function saveTokens(tokens) {
    await db.auth.put({
        key: 'tokens',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + (tokens.expires_in * 1000)
    });
}

export async function refreshAccessToken() {
    const authData = await db.auth.get('tokens');
    if (!authData || !authData.refreshToken) return null;

    const params = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: authData.refreshToken
    });

    const response = await fetch('https://secure.soundcloud.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
    });

    if (!response.ok) {
        await db.auth.delete('tokens');
        return null;
    }

    const tokens = await response.json();
    await saveTokens(tokens);
    return tokens.access_token;
}

export async function getAccessToken() {
    const authData = await db.auth.get('tokens');
    if (!authData) return null;

    // Refresh if expired or expiring in next 5 minutes
    if (Date.now() > authData.expiresAt - 300000) {
        return await refreshAccessToken();
    }

    return authData.accessToken;
}

export async function fetchAuthenticated(url) {
    const token = await getAccessToken();
    if (!token) throw new Error('Not authenticated');

    const res = await fetch(url, {
        headers: {
            'Authorization': `OAuth ${token}`
        }
    });

    if (res.status === 401) {
        // Force logout or refresh
        throw new Error('Unauthorized');
    }

    return res.json();
}

// API Methods
export async function resolveUser(url) {
    const encodedUrl = encodeURIComponent(url);
    const data = await fetchAuthenticated(`https://api.soundcloud.com/resolve?url=${encodedUrl}`);
    
    if (data.kind !== 'user') {
        throw new Error('URL does not point to a SoundCloud user');
    }
    
    return data;
}

export async function getUserLikes(userId) {
    // SC uses 'favorites' for likes in the API
    const data = await fetchAuthenticated(`https://api.soundcloud.com/users/${userId}/favorites?limit=50&linked_partitioning=1`);
    return (data.collection || []).map(item => ({
        ...item,
        type: 'like',
        created_at: item.created_at // Favorites usually have their own timestamp
    }));
}

export async function getUserReposts(userId) {
    const data = await fetchAuthenticated(`https://api.soundcloud.com/users/${userId}/reposts?limit=50&linked_partitioning=1`);
    return (data.collection || []).map(item => ({
        ...item.track, // Reposts often nest the track
        type: 'repost',
        created_at: item.created_at // Use the repost timestamp
    }));
}