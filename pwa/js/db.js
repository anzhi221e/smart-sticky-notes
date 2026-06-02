import { getSupabase } from './supabase.js';

export async function fetchNotes(limit = 50, workspace = null) {
    const sb = getSupabase();
    let query = sb
        .from('smartstickynotes_items')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(limit);
    if (workspace) query = query.eq('workspace', workspace);
    const { data, error } = await query;
    if (error) throw error;
    return data;
}

export async function fetchDeletedNotes() {
    const sb = getSupabase();
    const { data, error } = await sb
        .from('smartstickynotes_items')
        .select('*')
        .eq('status', 'deleted')
        .order('deleted_at', { ascending: false });
    if (error) throw error;
    return data;
}

export async function fetchNotesByDateRange(from, to, workspace = null) {
    const sb = getSupabase();
    let query = sb
        .from('smartstickynotes_items')
        .select('id, type, text, tags, audio_path, audio_duration, created_at, status')
        .eq('status', 'active')
        .gte('created_at', from)
        .lte('created_at', to)
        .order('created_at', { ascending: false });
    if (workspace) query = query.eq('workspace', workspace);
    const { data, error } = await query;
    if (error) throw error;
    return data;
}

export async function fetchNoteDates(workspace = null) {
    const sb = getSupabase();
    let query = sb
        .from('smartstickynotes_items')
        .select('created_at')
        .eq('status', 'active');
    if (workspace) query = query.eq('workspace', workspace);
    const { data, error } = await query;
    if (error) throw error;
    return data.map(d => d.created_at);
}

export async function insertNote(note) {
    const sb = getSupabase();
    const row = {
        type: note.type,
        text: note.text,
        tags: note.tags || [],
        workspace: note.workspace || 'Main',
        audio_path: note.audio_path || null,
        audio_duration: note.audio_duration || null,
    };
    if (note.id) row.id = note.id;
    const { data, error } = await sb
        .from('smartstickynotes_items')
        .insert(row)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function softDeleteNote(id) {
    const sb = getSupabase();
    const { error } = await sb
        .from('smartstickynotes_items')
        .update({ status: 'deleted', deleted_at: new Date().toISOString() })
        .eq('id', id);
    if (error) throw error;
}

export async function restoreNote(id) {
    const sb = getSupabase();
    const { error } = await sb
        .from('smartstickynotes_items')
        .update({ status: 'active', deleted_at: null })
        .eq('id', id);
    if (error) throw error;
}

export async function permanentDeleteNote(id, audioPath) {
    const sb = getSupabase();
    if (audioPath) {
        try { await sb.storage.from('smartstickynotes_audio').remove([audioPath]); } catch (e) { /* ignore */ }
    }
    await sb.from('deletion_events').insert({
        note_id: id,
        audio_path: audioPath || null,
    });
    const { error } = await sb.from('smartstickynotes_items').delete().eq('id', id);
    if (error) throw error;
}

export async function uploadAudio(noteId, blob) {
    const sb = getSupabase();
    const user = await sb.auth.getUser();
    const userId = user.data.user.id;
    const path = `${userId}/${noteId}.opus`;
    const { error } = await sb.storage
        .from('smartstickynotes_audio')
        .upload(path, blob, { contentType: 'audio/webm', upsert: true });
    if (error) throw error;
    return path;
}

export async function getAudioSignedUrl(audioPath) {
    const sb = getSupabase();
    const { data, error } = await sb.storage
        .from('smartstickynotes_audio')
        .createSignedUrl(audioPath, 3600);
    if (error) throw error;
    return data.signedUrl;
}

export async function fetchTags(workspace = null) {
    const sb = getSupabase();
    let query = sb
        .from('smartstickynotes_items')
        .select('tags')
        .eq('status', 'active');
    if (workspace) query = query.eq('workspace', workspace);
    const { data, error } = await query;
    if (error) throw error;
    const tagCounts = {};
    data.forEach(row => {
        (row.tags || []).forEach(tag => {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
    });
    return tagCounts;
}

export async function fetchNotesByTag(tag, workspace = null) {
    const sb = getSupabase();
    let query = sb
        .from('smartstickynotes_items')
        .select('*')
        .eq('status', 'active')
        .contains('tags', [tag])
        .order('created_at', { ascending: false });
    if (workspace) query = query.eq('workspace', workspace);
    const { data, error } = await query;
    if (error) throw error;
    return data;
}

export async function readConfig() {
    const sb = getSupabase();
    const { data, error } = await sb
        .from('smartstickynotes_config')
        .select('key, value');
    if (error) throw error;
    const cfg = {};
    data.forEach(row => { cfg[row.key] = row.value; });
    return cfg;
}

export async function writeConfig(key, value) {
    const sb = getSupabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { error } = await sb
        .from('smartstickynotes_config')
        .upsert({ user_id: user.id, key, value, updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' });
    if (error) throw error;
}

export async function batchUpdateWorkspace(oldName, newName) {
    const sb = getSupabase();
    const { error } = await sb
        .from('smartstickynotes_items')
        .update({ workspace: newName, updated_at: new Date().toISOString() })
        .eq('workspace', oldName);
    if (error) throw error;
}

export async function batchSoftDeleteByWorkspace(name) {
    const sb = getSupabase();
    const now = new Date().toISOString();
    const { error } = await sb
        .from('smartstickynotes_items')
        .update({ status: 'deleted', deleted_at: now, updated_at: now })
        .eq('workspace', name)
        .eq('status', 'active');
    if (error) throw error;
}
