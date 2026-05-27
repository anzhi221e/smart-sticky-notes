// Supabase client initialization
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

let supabase = null;

export function initSupabase(url, anonKey) {
    supabase = createClient(url, anonKey, {
        auth: {
            persistSession: true,
            storageKey: 'ssn-auth',
            autoRefreshToken: true,
        },
    });
    return supabase;
}

export function getSupabase() {
    if (!supabase) {
        const url = localStorage.getItem('ssn_supabase_url');
        const key = localStorage.getItem('ssn_supabase_anon_key');
        if (url && key) {
            supabase = createClient(url, key, {
                auth: { persistSession: true, storageKey: 'ssn-auth', autoRefreshToken: true },
            });
        }
    }
    return supabase;
}

export function saveConnection(url, anonKey) {
    localStorage.setItem('ssn_supabase_url', url);
    localStorage.setItem('ssn_supabase_anon_key', anonKey);
}

export function getConnection() {
    return {
        url: localStorage.getItem('ssn_supabase_url'),
        anonKey: localStorage.getItem('ssn_supabase_anon_key'),
    };
}
