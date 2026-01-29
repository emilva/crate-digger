import { db } from './db.js';

const CLIENT_ID = 'OvQ9pSBM9BAErgRohwPy83moZt2GL5vJ'; 

const REDIRECT_URI = (() => {
    const url = new URL(window.location.href);
    const pathParts = url.pathname.split('/');
    if (pathParts[1] === 'crate-digger') {
        return `${url.origin}/crate-digger/callback.html`;
    }
    return `${url.origin}/callback.html`;
})();

export function initiateAuth() {
    const state = Math.random().toString(36).substring(2);
    sessionStorage.setItem('sc_state', state);

    const authUrl = new URL('https://secure.soundcloud.com/authorize');
    authUrl.searchParams.append('client_id', CLIENT_ID);
    authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.append('response_type', 'token'); // Changed from 'code' to 'token'
    authUrl.searchParams.append('state', state);
    authUrl.searchParams.append('display', 'popup');

    window.open(authUrl.toString(), 'sc_auth', 'width=500,height=700');
}

export async function handleCallback(accessToken, state, expiresIn) {
    const savedState = sessionStorage.getItem('sc_state');
    if (state !== savedState) {
        throw new Error('State mismatch');
    }

    // With Implicit Flow, we get the token directly
    await db.auth.put({
        key: 'tokens',
        accessToken: accessToken,
        expiresAt: Date.now() + (parseInt(expiresIn) * 1000)
    });

    return accessToken;
}

export async function getAccessToken() {
    const authData = await db.auth.get('tokens');
    if (!authData) return null;

    if (Date.now() > authData.expiresAt) {
        await db.auth.delete('tokens');
        return null; // Implicit flow tokens cannot be refreshed, must re-auth
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
        throw new Error('Unauthorized');
    }

    return res.json();
}

// API Methods
export async function resolveUser(url) {
    const encodedUrl = encodeURIComponent(url);
    const data = await fetchAuthenticated(`https://api.soundcloud.com/resolve?url=${encodedUrl}`);
    if (data.kind !== 'user') throw new Error('URL does not point to a SoundCloud user');
    return data;
}

export async function getUserLikes(userId) {
    const data = await fetchAuthenticated(`https://api.soundcloud.com/users/${userId}/favorites?limit=50&linked_partitioning=1`);
    return (data.collection || []).map(item => ({
        ...item,
        type: 'like',
        created_at: item.created_at
    }));
}

export async function getUserReposts(userId) {
    const data = await fetchAuthenticated(`https://api.soundcloud.com/users/${userId}/reposts?limit=50&linked_partitioning=1`);
    return (data.collection || []).map(item => ({
        ...item.track,
        type: 'repost',
        created_at: item.created_at
    }));
}
