export type MessageMedia = {
    id: string;
    kind: 'image' | 'voice';
    mimeType: string;
    bytes: number;
};
