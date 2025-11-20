import { Participant } from './types';

export const MOCK_PARTICIPANTS: Participant[] = Array.from({ length: 59 }).map((_, i) => ({
  id: `user-${i + 2}`,
  name: `Участник ${i + 1}`,
  avatarUrl: `https://picsum.photos/seed/${i + 100}/200/200`,
  isMuted: Math.random() > 0.7,
  isVideoOff: Math.random() > 0.8,
  isSpeaking: false,
  // Simulate a few users sharing their screen
  isScreenSharing: i === 3 || i === 12, 
  role: 'guest'
}));

// Add an AI Participant
export const AI_PARTICIPANT: Participant = {
  id: 'gemini-ai',
  name: 'Gemini AI (Модератор)',
  avatarUrl: 'https://picsum.photos/seed/gemini/200/200', 
  isMuted: false,
  isVideoOff: false,
  isSpeaking: false,
  role: 'ai'
};