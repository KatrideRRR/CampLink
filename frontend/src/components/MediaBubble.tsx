import { useEffect, useState } from 'react';
import { apiFetch } from '../services/native-auth';
import { VoiceMessagePlayer } from './VoiceMessagePlayer';
import type {
    MessageMedia,
} from '../services/media-types';

type Props = {
    media: MessageMedia;
    onReact?: () => void;
};

export function MediaBubble({
    media,
    onReact,
}: Props) {
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        let active = true;
        let objectUrl: string | null = null;

        setUrl(null);
        setError(false);

        async function load() {
            try {
                const response = await apiFetch(
                    `/api/media/${encodeURIComponent(media.id)}`,
                    { signal: controller.signal }
                );

                if (!response.ok) {
                    throw new Error('Media request failed');
                }

                const blob = await response.blob();
                const nextUrl = URL.createObjectURL(blob);

                if (!active) {
                    URL.revokeObjectURL(nextUrl);
                    return;
                }

                objectUrl = nextUrl;
                setUrl(nextUrl);
            } catch {
                if (active && !controller.signal.aborted) {
                    setError(true);
                }
            }
        }

        void load();

        return () => {
            active = false;
            controller.abort();

            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        };
    }, [media.id, retry]);

    useEffect(() => {
        if (!expanded) return;

        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setExpanded(false);
            }
        };

        document.addEventListener('keydown', closeOnEscape);

        return () => {
            document.removeEventListener(
                'keydown', closeOnEscape
            );
        };
    }, [expanded]);

    if (!url) {
        return (
            <div className="media-placeholder">
                {error ? (
                    <>
                        <span>Не удалось загрузить вложение</span>
                        <button
                            type="button"
                            onClick={() => setRetry(value => value + 1)}
                        >
                            Повторить
                        </button>
                    </>
                ) : (
                    'Загружаем вложение…'
                )}
            </div>
        );
    }

    if (media.kind === 'voice') {
        return <VoiceMessagePlayer url={url} onReact={onReact} />;
    }

    return (
        <>
            <button
                type="button"
                className="media-photo"
                aria-label="Открыть фотографию"
                onClick={e => {
                    e.stopPropagation();
                    setExpanded(true);
                }}
                onTouchStart={e => e.stopPropagation()}
                onTouchEnd={e => e.stopPropagation()}
                onDoubleClick={e => e.stopPropagation()}
            >
                <img
                    src={url}
                    alt="Фотография в переписке"
                    loading="lazy"
                />
            </button>

            {expanded && (
                <div
                    className="media-lightbox"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Просмотр фотографии"
                    onClick={e => {
                        e.stopPropagation();
                        setExpanded(false);
                    }}
                    onTouchStart={e => e.stopPropagation()}
                    onTouchEnd={e => e.stopPropagation()}
                >
                    <button
                        type="button"
                        className="media-lightbox-close"
                        aria-label="Закрыть фотографию"
                        onClick={event => {
                            event.stopPropagation();
                            setExpanded(false);
                        }}
                    >
                        <svg
                            width="22"
                            height="22"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            aria-hidden="true"
                        >
                            <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                    </button>
                    <img src={url} alt="Фотография" />
                </div>
            )}
        </>
    );
}
