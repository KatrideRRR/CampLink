const formats = {
    image: {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
    },
    voice: {
        'audio/mp4': 'm4a',
        'audio/webm': 'webm',
        'audio/ogg': 'ogg',
    },
};

export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

export function inspectMedia(kind, mimeType, bytes) {
    if (
        !Buffer.isBuffer(bytes) ||
        bytes.length < 12 ||
        bytes.length > MAX_MEDIA_BYTES
    ) {
        return null;
    }

    const extension = formats[kind]?.[mimeType];

    if (!extension) return null;

    const png =
        bytes.subarray(0, 8).equals(
            Buffer.from('89504e470d0a1a0a', 'hex')
        );

    const jpeg =
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff;

    const webp =
        bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.toString('ascii', 8, 12) === 'WEBP';

    const mp4 =
        bytes.toString('ascii', 4, 8) === 'ftyp';

    const webm =
        bytes.subarray(0, 4).equals(
            Buffer.from('1a45dfa3', 'hex')
        );

    const ogg =
        bytes.toString('ascii', 0, 4) === 'OggS';

    const valid = {
        'image/jpeg': jpeg,
        'image/png': png,
        'image/webp': webp,
        'audio/mp4': mp4,
        'audio/webm': webm,
        'audio/ogg': ogg,
    }[mimeType];

    return valid ? { extension, mimeType, kind } : null;
}
