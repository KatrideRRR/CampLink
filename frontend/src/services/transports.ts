
export type TransportKind =
    | 'internet'
    | 'email'
    | 'sms'
    | 'mesh';

export interface OutboundPacket {
    messageId: string;
    recipientId: string;
    payload: Uint8Array;
}

export interface MessageTransport {
    readonly kind: TransportKind;

    isAvailable(): Promise<boolean>;

    send(packet: OutboundPacket): Promise<void>;
}
