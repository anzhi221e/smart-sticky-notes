import { isOnline } from './offline.js';

let mediaRecorder = null;
let audioChunks = [];
let recognition = null;
let isRecording = false;
let onTranscription = null;
let onRecordingState = null;

function getBestMimeType() {
    const types = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
    ];
    for (const t of types) {
        if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return 'audio/webm';
}

export async function startRecording({ onText, onState }) {
    if (!isOnline()) {
        throw new Error('offline');
    }

    onTranscription = onText;
    onRecordingState = onState;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = getBestMimeType();
    mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 16000,
    });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
    };

    // Start speech recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.lang = 'zh-CN';
        recognition.interimResults = true;
        recognition.continuous = true;
        recognition.onresult = (e) => {
            let text = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                text += e.results[i][0].transcript;
            }
            if (onTranscription) onTranscription(text, e.results[e.results.length - 1].isFinal);
        };
        recognition.onerror = (e) => {
            console.warn('Speech recognition error:', e.error);
        };
        recognition.start();
    }

    mediaRecorder.start(100);
    isRecording = true;
    // Return whether speech recognition is actually available
    if (onRecordingState) onRecordingState('recording', !!recognition);
}

export function isSpeechSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function stopRecording() {
    return new Promise((resolve) => {
        if (!mediaRecorder || !isRecording) {
            resolve(null);
            return;
        }

        mediaRecorder.onstop = () => {
            const mimeType = mediaRecorder.mimeType || 'audio/webm';
            const blob = new Blob(audioChunks, { type: mimeType });
            mediaRecorder.stream.getTracks().forEach(t => t.stop());
            if (recognition) {
                recognition.stop();
                recognition = null;
            }
            isRecording = false;
            const duration = Math.round(audioChunks.reduce((acc, chunk) => acc + chunk.size, 0) / (16000 / 8));
            resolve({ blob, duration, mimeType });
        };

        mediaRecorder.stop();
        if (onRecordingState) onRecordingState('stopped');
    });
}

export function cancelRecording() {
    if (recognition) {
        recognition.abort();
        recognition = null;
    }
    if (mediaRecorder && isRecording) {
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
        mediaRecorder = null;
        isRecording = false;
        audioChunks = [];
    }
    if (onRecordingState) onRecordingState('cancelled');
}

export function getIsRecording() {
    return isRecording;
}
