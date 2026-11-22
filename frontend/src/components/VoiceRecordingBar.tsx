import { useEffect, useRef, useState } from 'react';
import {
    formatVoiceTime,
    voiceBarLevels,
} from '../services/voice-visualization';

type Props = {
    stream: MediaStream;
    hint: string;
};

export function VoiceRecordingBar({
    stream,
    hint,
}: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [seconds, setSeconds] = useState(0);

    useEffect(() => {
        const startedAt = performance.now();

        const timer = window.setInterval(() => {
            setSeconds(
                Math.floor((performance.now() - startedAt) / 1000)
            );
        }, 250);

        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');

        if (!canvas || !context) return;

        let audioContext: AudioContext | null = null;
        let source: MediaStreamAudioSourceNode | null = null;
        let analyser: AnalyserNode | null = null;
        let spectrum = new Uint8Array(0);
        let frame = 0;
        let lastDraw = 0;

        try {
            audioContext = new AudioContext();
            source = audioContext.createMediaStreamSource(stream);
            analyser = audioContext.createAnalyser();

            analyser.fftSize = 1024;
            analyser.smoothingTimeConstant = 0.75;

            source.connect(analyser);
            spectrum = new Uint8Array(analyser.frequencyBinCount);

            void audioContext.resume().catch(() => {
                // Flat waveform if Web Audio is unavailable.
            });
        } catch {
            // Recording still works without visualization.
        }

        function draw(now: number) {
            if (!canvas || !context) return;

            if (now - lastDraw >= 50) {
                lastDraw = now;

                if (analyser && audioContext?.state === 'running') {
                    analyser.getByteFrequencyData(spectrum);
                } else {
                    spectrum.fill(0);
                }

                const bars = voiceBarLevels(spectrum, 28);
                const width = canvas.clientWidth;
                const height = canvas.clientHeight;

                const ratio = Math.min(
                    window.devicePixelRatio || 1,
                    2
                );

                const pixelWidth = Math.round(width * ratio);
                const pixelHeight = Math.round(height * ratio);

                if (
                    canvas.width !== pixelWidth ||
                    canvas.height !== pixelHeight
                ) {
                    canvas.width = pixelWidth;
                    canvas.height = pixelHeight;
                }

                context.setTransform(
                    ratio, 0, 0, ratio, 0, 0
                );
                context.clearRect(0, 0, width, height);

                const gap = 3;
                const barWidth = Math.max(
                    1,
                    (width - gap * (bars.length - 1)) /
                    bars.length
                );

                context.fillStyle = '#e8ff72';

                bars.forEach((level, index) => {
                    const barHeight =
                        4 + level * (height - 6);

                    const x = index * (barWidth + gap);
                    const y = (height - barHeight) / 2;

                    context.fillRect(
                        x,
                        y,
                        barWidth,
                        barHeight
                    );
                });
            }

            frame = window.requestAnimationFrame(draw);
        }

        frame = window.requestAnimationFrame(draw);

        return () => {
            window.cancelAnimationFrame(frame);
            source?.disconnect();
            analyser?.disconnect();

            if (audioContext) {
                void audioContext.close().catch(() => {});
            }
        };
    }, [stream]);

    return (
        <div
            className="voice-record-bar"
            role="group"
            aria-label="Идёт запись голосового сообщения"
        >
            <span
                className="voice-record-dot"
                aria-hidden="true"
            />
            <div className="voice-record-main">
                <canvas
                    ref={canvasRef}
                    aria-hidden="true"
                />
                <span className="voice-record-caption">
                    <span>{hint}</span>
                    <time>{formatVoiceTime(seconds)}</time>
                </span>
            </div>
        </div>
    );
}
