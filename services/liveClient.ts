import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';

// Audio utils
function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

function downsample(buffer: Float32Array, inputRate: number, outputRate: number): Float32Array {
    if (inputRate === outputRate) return buffer;
    const ratio = inputRate / outputRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
        result[i] = buffer[Math.floor(i * ratio)];
    }
    return result;
}

function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export class LiveClient {
  private ai: GoogleGenAI;
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private nextStartTime = 0;
  private isConnected = false;
  private sessionPromise: Promise<any> | null = null;
  
  public onSpeakingStateChange: (isSpeaking: boolean) => void = () => {};
  public onConnectionStateChange: (isConnected: boolean) => void = () => {};

  constructor() {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        // Do not throw here to allow app to load, but log warning
        console.warn("API_KEY not found");
    }
    this.ai = new GoogleGenAI({ apiKey: apiKey || "dummy_key" });
  }

  async connect(audioDeviceId?: string) {
    if (this.isConnected) return;

    // Use default sample rate to avoid "NotSupportedError" on some browsers/devices
    this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Resume context immediately (fix for Chrome autoplay policy)
    await this.inputAudioContext.resume();
    await this.outputAudioContext.resume();

    try {
      const constraints: MediaStreamConstraints = {
        audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true
      };
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      console.error("Microphone access denied", e);
      return;
    }

    try {
        this.sessionPromise = this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: "You are a helpful video conference assistant named Gemini. You are participating in a large meeting. Be concise, professional, and helpful. Speak Russian.",
            speechConfig: {
                voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Kore'}},
            },
        },
        callbacks: {
            onopen: this.onOpen.bind(this),
            onmessage: this.onMessage.bind(this),
            onclose: () => {
                console.log("Live session closed");
                this.disconnect();
            },
            onerror: (err) => {
                console.error("Live session error", err);
                this.disconnect();
            },
        }
        });
    } catch (err) {
        console.error("Failed to initiate Live Connect", err);
        this.disconnect();
    }
  }

  private onOpen() {
    this.isConnected = true;
    this.onConnectionStateChange(true);

    if (!this.inputAudioContext || !this.stream) return;

    this.source = this.inputAudioContext.createMediaStreamSource(this.stream);
    this.processor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (!this.isConnected) return;

      const inputData = e.inputBuffer.getChannelData(0);
      // Downsample system audio (usually 44.1k or 48k) to 16k expected by Gemini
      const downsampledData = downsample(inputData, this.inputAudioContext!.sampleRate, 16000);
      
      // Simple silence detection or guard could go here, but SDK handles silence reasonably well.
      // Ensure we don't send empty data
      if (downsampledData.length > 0) {
          const blob = createBlob(downsampledData);
          this.sessionPromise?.then(session => {
            if (this.isConnected) {
                session.sendRealtimeInput({ media: blob });
            }
          });
      }
    };

    this.source.connect(this.processor);
    this.processor.connect(this.inputAudioContext.destination);
  }

  private async onMessage(message: LiveServerMessage) {
    const audioString = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audioString && this.outputAudioContext) {
      this.onSpeakingStateChange(true);
      
      this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
      
      const audioBuffer = await decodeAudioData(
        decode(audioString),
        this.outputAudioContext,
        24000,
        1
      );

      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      const node = this.outputAudioContext.createGain();
      source.connect(node);
      node.connect(this.outputAudioContext.destination);
      
      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;

      source.onended = () => {
          if (this.outputAudioContext && this.outputAudioContext.currentTime >= this.nextStartTime) {
             this.onSpeakingStateChange(false);
          }
      };
    }
  }

  disconnect() {
    if (!this.isConnected && !this.sessionPromise) return;

    this.isConnected = false;
    this.onConnectionStateChange(false);
    this.onSpeakingStateChange(false);

    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    
    // Close contexts safely
    this.inputAudioContext?.close().catch(() => {});
    this.outputAudioContext?.close().catch(() => {});
    
    this.sessionPromise?.then(s => {
        try {
            s.close(); 
        } catch(e) {
            // Ignore close errors
        }
    });
    
    this.sessionPromise = null;
    this.inputAudioContext = null;
    this.outputAudioContext = null;
    this.stream = null;
    this.processor = null;
    this.source = null;
  }
}