import { useRef, useState } from 'react';
import { formatVoiceTime } from '../services/voice-visualization';

type Props = {
    url: string;
    onReact?: () => void;
};

export function VoiceMessagePlayer({
    url,
    onReact,
}: Props) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);
    const [position, setPosition] = useState(0);
    const [duration, setDuration] = useState(0);
    const [error, setError] = useState(false);

    function readDuration(audio: HTMLAudioElement) {
        if (
            Number.isFinite(audio.duration) &&
            audio.duration > 0
        ) {
            setDuration(audio.duration);
        }
    }

    function togglePlayback() {
        const audio = audioRef.current;
        if (!audio) return;

        if (audio.paused) {
            setError(false);

            void audio.play().catch(() => {
                setPlaying(false);
                setError(true);
            });
        } else {
            audio.pause();
        }
    }

    return (
        <div
            className="voice-player"
            aria-label="Голосовое сообщение"
        >
            <audio
                ref={audioRef}
                src={url}
                preload="metadata"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => {
                    setPlaying(false);
                    setPosition(0);
                }}
                onTimeUpdate={event => {
                    setPosition(event.currentTarget.currentTime);
                }}
                onLoadedMetadata={event => {
                    readDuration(event.currentTarget);
                }}
                onDurationChange={event => {
                    readDuration(event.currentTarget);
                }}
                onError={() => {
                    setPlaying(false);
                    setError(true);
                }}
            />

            <button
                type="button"
                className="voice-player-toggle"
                aria-label={playing ? 'Пауза' : 'Воспроизвести'}
                onClick={togglePlayback}
            >
                {playing ? (
                    <svg
                        viewBox="0 0 24 24"
                        width="20"
                        height="20"
                        fill="currentColor"
                        aria-hidden="true"
                    >
                        <rect x="6" y="4" width="4" height="16" rx="1" />
                        <rect x="14" y="4" width="4" height="16" rx="1" />
                    </svg>
                ) : (
                    <svg
                        viewBox="0 0 24 24"
                        width="21"
                        height="21"
                        fill="currentColor"
                        aria-hidden="true"
                    >
                        <path d="M8 5.5a1 1 0 0 1 1.5-.86l10 6.5a1 1 0 0 1 0 1.72l-10 6.5A1 1 0 0 1 8 18.5Z" />
                    </svg>
                )}
            </button>

            <div className="voice-player-body">
                <input
                    type="range"
                    className="voice-player-progress"
                    aria-label="Перемотать голосовое сообщение"
                    min={0}
                    max={duration || 1}
                    step={0.1}
                    value={Math.min(position, duration || 1)}
                    disabled={duration <= 0}
                    onChange={event => {
                        const audio = audioRef.current;

                        if (!audio || duration <= 0) return;

                        const time = Number(event.target.value);
                        audio.currentTime = time;
                        setPosition(time);
                    }}
                />

                <span className="voice-player-time">
                    {error
                        ? 'Ошибка воспроизведения'
                        : `${formatVoiceTime(position)} / ${formatVoiceTime(duration)}`}
                </span>
            </div>

            {onReact && (
                <button
                    type="button"
                    className="voice-player-react"
                    aria-label="Добавить реакцию на голосовое"
                    title="Реакция"
                    onClick={event => {
                        event.stopPropagation();
                        onReact();
                    }}
                >
                    <svg
                        viewBox="0 0 24 24"
                        width="20"
                        height="20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <circle cx="12" cy="12" r="9" />
                        <path d="M8 14c2.2 2.7 5.8 2.7 8 0" />
                        <path d="M9 9h.01M15 9h.01" />
                    </svg>
                </button>
            )}
        </div>
    );
}
