import { useEffect, useRef, useState } from 'react';
import type { ViewSnapshot } from '../../network/view-store';
import { usePreferences } from '../../settings/use-preferences';
import { audioManager } from '../../audio/audio-manager';
import {
  createEffectCursor,
  deriveEffects,
  type EffectSnapshot,
  type EffectKind,
} from './effect-cursor';
export function useTableEffects(snapshot: Readonly<ViewSnapshot>, active: boolean) {
  const preferences = usePreferences(),
    previous = useRef<EffectSnapshot | null>(null),
    cursor = useRef(createEffectCursor()),
    [effect, setEffect] = useState<EffectKind | null>(null);
  useEffect(() => {
    const v = snapshot.playerView,
      room = snapshot.roomView;
    const next: EffectSnapshot = {
      epoch: snapshot.activeEpoch ?? '',
      session: snapshot.authContext?.sessionId ?? '',
      room: room?.roomId ?? '',
      handId: v?.handId ?? null,
      version: v?.handVersion ?? 0,
      sequence: v?.publicEventSequence ?? 0,
      board: v?.board.length ?? 0,
      holes: v?.self.holeCards?.length ?? 0,
      seats: room?.seats.filter((s) => s.occupant).length ?? 0,
      settled: v?.phase === 'settled',
      ready: active && snapshot.controlReady && !snapshot.syncNeeded,
    };
    if (previous.current?.session !== next.session || previous.current?.epoch !== next.epoch)
      cursor.current.clear();
    for (const e of deriveEffects(previous.current, next))
      if (cursor.current.accept(e)) {
        audioManager.play(e.kind, preferences.soundEnabled);
        if (!preferences.reduceMotion) setEffect(e.kind);
      }
    previous.current = next;
  }, [active, snapshot, preferences.soundEnabled, preferences.reduceMotion]);
  useEffect(() => {
    if (!effect) return;
    const timer = setTimeout(() => setEffect(null), 220);
    return () => clearTimeout(timer);
  }, [effect]);
  useEffect(() => {
    if (!active || !preferences.soundEnabled) audioManager.stop();
  }, [active, preferences.soundEnabled]);
  useEffect(() => () => audioManager.stop(), []);
  return !active || preferences.reduceMotion ? null : effect;
}
