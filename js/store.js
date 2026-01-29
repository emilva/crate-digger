// Simple reactive store
const state = {
    user: null, // { id, username, ... }
    tastemakers: [],
    currentTrack: null, // { id, title, artist, soundcloudUrl, ... }
    loading: false,
    newDiscoveryCount: 0
};

const listeners = new Set();

const handler = {
    set(target, property, value) {
        target[property] = value;
        listeners.forEach(callback => callback(target));
        return true;
    }
};

export const store = new Proxy(state, handler);

export function subscribe(callback) {
    listeners.add(callback);
    callback(store); // Immediate call
    return () => listeners.delete(callback);
}

// Actions
export function setUser(user) {
    store.user = user;
}

export function setTastemakers(list) {
    store.tastemakers = list;
}

export function setCurrentTrack(track) {
    store.currentTrack = track;
}

export function setLoading(isLoading) {
    store.loading = isLoading;
}
