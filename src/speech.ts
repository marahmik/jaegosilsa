export type SpeechStatus = 'ready' | 'pending' | 'error';

export class ErrorSpeech {
  private readonly onStatus: (message: string, status: SpeechStatus) => void;
  private timer: number | undefined;
  private generation = 0;

  constructor(onStatus: (message: string, status: SpeechStatus) => void) {
    this.onStatus = onStatus;
    if (!('speechSynthesis' in window)) {
      onStatus('이 브라우저는 음성 출력을 지원하지 않습니다.', 'error');
      return;
    }
    window.speechSynthesis.addEventListener('voiceschanged', () => this.refresh());
    this.refresh();
  }

  refresh(): void {
    if (!('speechSynthesis' in window)) return;
    const voices = window.speechSynthesis.getVoices();
    if (voices.some(voice => voice.lang.toLowerCase().startsWith('ko'))) {
      this.onStatus('한국어 음성 준비됨 · 테스트로 청취 확인', 'ready');
    } else {
      this.onStatus('한국어 음성이 없습니다. Windows 음성 언어 설정을 확인하세요.', 'error');
    }
  }

  speakError(): void {
    const generation = ++this.generation;
    window.clearTimeout(this.timer);
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      this.onStatus('음성 출력 미지원: 화면 경고를 확인하세요.', 'error');
      return;
    }
    const synth = window.speechSynthesis;
    const voice = synth.getVoices().find(candidate => candidate.lang.toLowerCase().startsWith('ko'));
    if (!voice) {
      this.onStatus('한국어 음성 없음: Windows 한국어 음성 설치 후 테스트하세요.', 'error');
      return;
    }
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance('오류');
    utterance.lang = 'ko-KR';
    utterance.voice = voice;
    utterance.rate = 1;
    this.onStatus('오류 음성 재생 요청 중', 'pending');
    const finish = (message: string, status: SpeechStatus) => {
      if (generation !== this.generation) return;
      window.clearTimeout(this.timer);
      this.timer = undefined;
      this.onStatus(message, status);
    };
    utterance.onend = () => finish('음성 재생 완료 · 실제 소리는 직접 확인하세요.', 'ready');
    utterance.onerror = event => finish(`음성 실패 (${event.error}): 오디오 허용·음성 설치를 확인하세요.`, 'error');
    this.timer = window.setTimeout(() => {
      if (generation !== this.generation) return;
      synth.cancel();
      finish('음성 재생 확인 실패: 브라우저 오디오 정책을 확인하세요.', 'error');
    }, 8000);
    try {
      synth.speak(utterance);
    } catch (error) {
      finish(error instanceof Error ? `음성 출력 실패: ${error.message}` : '음성 출력 실패', 'error');
    }
  }
}

export class SuccessBeep {
  private context: AudioContext | undefined;
  private preparation: Promise<boolean> | undefined;
  private readonly onStatus: (message: string, status: SpeechStatus) => void;

  constructor(onStatus: (message: string, status: SpeechStatus) => void) {
    this.onStatus = onStatus;
  }

  prepareFromGesture(): void {
    if (this.context?.state === 'running') {
      this.preparation = undefined;
      return;
    }
    try {
      if (!('AudioContext' in window)) throw new Error('이 브라우저는 성공 알림음을 지원하지 않습니다.');
      this.context ??= new AudioContext();
      const context = this.context;
      const { promise, resolve } = Promise.withResolvers<boolean>();
      this.preparation = promise;
      let settled = false;
      const finish = (ready: boolean, message: string) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (this.preparation === promise) this.onStatus(message, ready ? 'ready' : 'error');
        resolve(ready);
      };
      const timer = window.setTimeout(() => finish(false, '성공 알림음 차단: 브라우저 오디오 허용을 확인하세요.'), 2000);
      this.onStatus('성공 알림음 준비 중', 'pending');
      void context.resume().then(
        () => finish(context.state === 'running', context.state === 'running' ? '정상 등록 시 짧은 알림음' : '성공 알림음을 재생할 수 없습니다.'),
        error => finish(false, error instanceof Error ? `성공 알림음 실패: ${error.message}` : '성공 알림음 재생 실패'),
      );
    } catch (error) {
      this.preparation = Promise.resolve(false);
      this.onStatus(error instanceof Error ? error.message : '성공 알림음 초기화 실패', 'error');
    }
  }

  async play(): Promise<void> {
    const prepared = this.preparation ? await this.preparation : undefined;
    const context = this.context;
    if (!context || context.state !== 'running') {
      if (prepared !== false) this.onStatus('성공 알림음 차단: 브라우저 오디오 허용을 확인하세요.', 'error');
      return;
    }
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.01);
      gain.gain.linearRampToValueAtTime(0, now + 0.08);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(now);
      oscillator.stop(now + 0.08);
      this.onStatus('정상 등록 시 짧은 알림음', 'ready');
    } catch (error) {
      this.onStatus(error instanceof Error ? `성공 알림음 실패: ${error.message}` : '성공 알림음 재생 실패', 'error');
    }
  }
}
