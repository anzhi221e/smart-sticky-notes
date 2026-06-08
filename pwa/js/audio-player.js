import { getAudioSignedUrl } from './db.js';

const urlCache = new Map();

async function getCachedUrl(audioPath) {
    const cached = urlCache.get(audioPath);
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
        return cached.url;
    }
    const url = await getAudioSignedUrl(audioPath);
    urlCache.set(audioPath, { url, timestamp: Date.now() });
    return url;
}

export function createAudioPlayer(audioPath, duration) {
    const container = document.createElement('div');
    container.className = 'audio-player';

    let audio = null;
    let isPlaying = false;
    let speed = 1.0;

    const playBtn = document.createElement('button');
    playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
    playBtn.setAttribute('aria-label', '播放');

    const timeDisplay = document.createElement('span');
    timeDisplay.className = 'time-display';
    const formatTime = (s) => {
        if (!isFinite(s) || s < 0) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, '0')}`;
    };
    timeDisplay.textContent = formatTime(0);

    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-bar';
    const progressFill = document.createElement('div');
    progressFill.className = 'progress-fill';
    progressContainer.appendChild(progressFill);

    const durationDisplay = document.createElement('span');
    durationDisplay.className = 'time-display';
    durationDisplay.textContent = duration ? formatTime(duration) : '--:--';

    const speedBtn = document.createElement('button');
    speedBtn.className = 'speed-btn';
    speedBtn.textContent = '1x';

    container.appendChild(playBtn);
    container.appendChild(timeDisplay);
    container.appendChild(progressContainer);
    container.appendChild(durationDisplay);
    container.appendChild(speedBtn);

    async function initAudio() {
        if (!audio) {
            const url = await getCachedUrl(audioPath);
            audio = new Audio(url);
            audio.addEventListener('timeupdate', () => {
                timeDisplay.textContent = formatTime(audio.currentTime);
                const dur = audio.duration || duration || 1;
                if (isFinite(dur) && dur > 0) {
                    progressFill.style.width = `${Math.min(100, (audio.currentTime / dur) * 100)}%`;
                }
            });
            audio.addEventListener('ended', () => {
                isPlaying = false;
                playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
            });
            audio.addEventListener('loadedmetadata', () => {
                if (!duration || audio.duration) {
                    durationDisplay.textContent = formatTime(audio.duration || duration);
                }
            });
        }
        return audio;
    }

    playBtn.addEventListener('click', async () => {
        const a = await initAudio();
        if (isPlaying) {
            a.pause();
            isPlaying = false;
            playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
        } else {
            a.playbackRate = speed;
            await a.play();
            isPlaying = true;
            playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
        }
    });

    progressContainer.addEventListener('click', async (e) => {
        const a = await initAudio();
        const rect = progressContainer.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        a.currentTime = ratio * (a.duration || duration || 0);
    });

    speedBtn.addEventListener('click', async () => {
        const speeds = [1.0, 1.5, 2.0];
        const idx = speeds.indexOf(speed);
        speed = speeds[(idx + 1) % speeds.length];
        speedBtn.textContent = speed + 'x';
        if (audio) audio.playbackRate = speed;
    });

    return container;
}
