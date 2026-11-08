export interface FaultProxy {
  origin: string;
  setProfile(value: 'base' | 'rtt100' | 'rtt300'): void;
  dropNextActionAck(): void;
  readonly stats: {
    connections: number;
    clientFrames: number;
    serverFrames: number;
    droppedAcks: number;
    overflowClosures: number;
  };
  close(): Promise<void>;
}
export function startFaultProxy(options: {
  port?: number;
  target: string;
  origin: string;
}): Promise<FaultProxy>;
