import { useEffect, useState } from 'react';
import { apiFetch } from '../services/native-auth';
import type {
    MessageMedia,
} from '../services/media-types';

type Props = {
    media: MessageMedia;
    connected: boolean;
};

export function MediaBubble({
    media,
    connected,
}: Props) {
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState(false);
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        const controller = new AbortController();
        let active = true;
        let objectUrl: string | null = null;

        setUrl(null);
        setError(false);

        if (!connected) {
            return () => controller.abort();
        }

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
    }, [media.id, connected]);

    if (!url) {
        return (
            <div className="media-placeholder">
                {error
                    ? 'Не удалось загрузить вложение'
                    : connected
                        ? 'Загружаем вложение…'
                        : 'Вложение доступно при подключении'}
            </div>
        );
    }

    if (media.kind === 'voice') {
        return (
            <div
                className="voice-message"
                onTouchStart={e => e.stopPropagation()}
                onTouchEnd={e => e.stopPropagation()}
                onDoubleClick={e => e.stopPropagation()}
            >
                <span>Голосовое сообщение</span>
                <audio
                    src={url}
                    controls
                    preload="metadata"
                />
            </div>
        );
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
                        aria-label="Закрыть фотографию"
                    >
                        Закрыть ×
                    </button>
                    <img src={url} alt="Фотография" />
                </div>
            )}
        </>
    );
}
