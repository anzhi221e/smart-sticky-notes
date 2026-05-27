import { getSupabase } from './supabase.js';

export async function sendMagicLink(email) {
    const sb = getSupabase();
    const { error } = await sb.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
    });
    return { error };
}

export async function getSession() {
    const sb = getSupabase();
    const { data: { session } } = await sb.auth.getSession();
    return session;
}

export async function getUser() {
    const sb = getSupabase();
    const { data: { user } } = await sb.auth.getUser();
    return user;
}

export async function signOut() {
    const sb = getSupabase();
    await sb.auth.signOut();
}

export function onAuthStateChange(callback) {
    const sb = getSupabase();
    return sb.auth.onAuthStateChange((event, session) => {
        callback(event, session);
    });
}
