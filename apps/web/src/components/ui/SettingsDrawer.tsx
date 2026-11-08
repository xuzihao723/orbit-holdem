import { useState } from 'react';
import { usePreferences } from '../../settings/use-preferences';
import { getPreferencesStore } from '../../settings/preferences-store';
import { audioManager } from '../../audio/audio-manager';
import ModalDialog from './ModalDialog';
export default function SettingsDrawer({ quickSound = false }: { quickSound?: boolean }) {
  const [open, setOpen] = useState(false),
    p = usePreferences(),
    store = getPreferencesStore();
  const setSound = (enabled: boolean) => {
    audioManager.unlock();
    store.update({ soundEnabled: enabled });
    if (enabled) audioManager.play('join', true);
    else audioManager.stop();
  };
  return (
    <>
      {quickSound && (
        <button
          className="icon-button"
          aria-label="音效"
          aria-pressed={p.soundEnabled}
          title={p.soundEnabled ? '关闭音效' : '开启音效'}
          onClick={() => setSound(!p.soundEnabled)}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 9v6h4l5 4V5L7 9H3Z" />
            {p.soundEnabled ? (
              <path d="M16 9a4.4 4.4 0 0 1 0 6m2-8a7.5 7.5 0 0 1 0 10" />
            ) : (
              <path d="m16 10 5 5m0-5-5 5" />
            )}
          </svg>
        </button>
      )}
      <button className="icon-button" onClick={() => setOpen(true)} aria-label="设置" title="设置">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            d="M10 3h4l.6 2.6 2 .9L19 5l2.8 2.8-1.5 2.4.9 2L24 13v4l-2.8.6-.9 2L22 22l-2.8 2.8-2.6-1.5-2 .9L14 27h-4l-.6-2.8-2-.9-2.6 1.5L2 22l1.7-2.4-.9-2L0 17v-4l2.8-.8.9-2L2.2 7.8 5 5l2.4 1.5 2-.9z"
            transform="translate(2.2 .2) scale(.82)"
          />
          <circle cx="12" cy="12.5" r="3" />
        </svg>
      </button>
      {open && (
        <ModalDialog title="牌桌设置" onClose={() => setOpen(false)}>
          <div className="settings-fields">
            <label>
              <input
                type="checkbox"
                checked={p.soundEnabled}
                onChange={(e) => setSound(e.target.checked)}
              />
              开启音效
            </label>
            <label>
              <input
                type="checkbox"
                checked={p.reduceMotion}
                onChange={(e) => store.update({ reduceMotion: e.target.checked })}
              />
              减少动画
            </label>
            <label>
              花色模式
              <select
                aria-label="花色模式"
                value={p.suitMode}
                onChange={(e) => store.update({ suitMode: e.target.value as typeof p.suitMode })}
              >
                <option value="standard">标准双色</option>
                <option value="four">四花色</option>
              </select>
            </label>
            <label>
              统一牌背
              <select
                aria-label="统一牌背"
                value={p.cardBack}
                onChange={(e) => store.update({ cardBack: e.target.value as typeof p.cardBack })}
              >
                <option value="orbit">轨道星图</option>
                <option value="orbit-simple">简洁轨道</option>
              </select>
            </label>
            <p>设置只保存在本机，不改变牌值、筹码或行动期限。</p>
          </div>
        </ModalDialog>
      )}
    </>
  );
}
