export interface Participant {
  id: string;
  name: string;
  avatarUrl: string;
  isMuted: boolean;
  isVideoOff: boolean;
  isSpeaking: boolean;
  isScreenSharing?: boolean;
  role: 'host' | 'guest' | 'ai';
}

export enum ViewMode {
  GALLERY = 'GALLERY',
  SPEAKER = 'SPEAKER',
  SCREEN_SHARE = 'SCREEN_SHARE'
}

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: Date;
  isAi?: boolean;
}
