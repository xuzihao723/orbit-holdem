import type { EffectKind } from '../features/table/effect-cursor';
const urls = import.meta.glob<string>('../../../../assets/audio/*.{ogg,mp3}', {
  query: '?url',
  import: 'default',
  eager: true,
});
export class AudioManager {
  constructor(private factory: (src: string) => HTMLAudioElement = (src) => new Audio(src)) {}
  private unlocked = false;
  private voices = new Set<HTMLAudioElement>();
  unlock() {
    this.unlocked = true;
  }
  stop() {
    for (const audio of this.voices) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    this.voices.clear();
  }
  play(id: EffectKind, enabled: boolean) {
    if (!enabled || !this.unlocked) return;
    if (this.voices.size >= 4) {
      const first = this.voices.values().next().value!;
      first.onended = null;
      first.onerror = null;
      first.pause();
      this.voices.delete(first);
    }
    const audio = this.factory(urls['../../../../assets/audio/' + id + '.ogg']!);
    audio.volume = 0.45;
    this.voices.add(audio);
    const finish = () => {
      this.voices.delete(audio);
      audio.onended = null;
      audio.onerror = null;
    };
    audio.onended = finish;
    audio.onerror = () => {
      audio.onerror = finish;
      audio.src = urls['../../../../assets/audio/' + id + '.mp3']!;
      void audio.play().catch(finish);
    };
    void audio.play().catch(finish);
  }
}
export const audioManager = new AudioManager();
