import React from 'react';

// Simple functional wrapper for consistent sizing
const IconWrapper: React.FC<{children: React.ReactNode, className?: string, onClick?: () => void}> = ({ children, className, onClick }) => (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
      onClick={onClick}
    >
      {children}
    </svg>
);

export const MicIcon = ({ className }: { className?: string }) => (
    <IconWrapper className={className}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></IconWrapper>
);

export const MicOffIcon = ({ className }: { className?: string }) => (
    <IconWrapper className={className}><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></IconWrapper>
);

export const VideoIcon = ({ className }: { className?: string }) => (
    <IconWrapper className={className}><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></IconWrapper>
);

export const VideoOffIcon = ({ className }: { className?: string }) => (
    <IconWrapper className={className}><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/></IconWrapper>
);

export const ScreenShareIcon = ({ className }: { className?: string }) => (
    <IconWrapper className={className}><path d="M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="M17 8l5-5"/><path d="M17 3h5v5"/></IconWrapper>
);

export const UsersIcon = ({ className }: { className?: string }) => (
    <IconWrapper className={className}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></IconWrapper>
);

export const MessageSquareIcon = ({ className }: { className?: string }) => (
    <IconWrapper className={className}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></IconWrapper>
);

export const PhoneOffIcon = ({ className }: { className?: string }) => (
    <IconWrapper className={className}><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="23" y1="1" x2="1" y2="23"/></IconWrapper>
);

export const LayoutGridIcon = ({ className }: { className?: string }) => (
    <IconWrapper className={className}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></IconWrapper>
);

export const SparklesIcon = ({ className }: { className?: string }) => (
    <IconWrapper className={className}><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L12 3Z"/></IconWrapper>
);

export const LinkIcon = ({ className }: { className?: string }) => (
    <IconWrapper className={className}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></IconWrapper>
);

export const TrashIcon = ({ className, onClick }: { className?: string, onClick?: () => void }) => (
    <IconWrapper className={className} onClick={onClick}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></IconWrapper>
);

export const ShieldIcon = ({ className }: { className?: string }) => (
    <IconWrapper className={className}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></IconWrapper>
);

export const MonitorUpIcon = ({ className }: { className?: string }) => (
    <IconWrapper className={className}><path d="M13.22 19h4.84a2 2 0 0 0 1.94-2.42l-1.57-8A2 2 0 0 0 16.48 7H4.08a2 2 0 0 0-1.96 1.58l-1.57 8A2 2 0 0 0 2.5 19h4.78"/><path d="M12 13v9"/><path d="M8 17l4-4 4 4"/></IconWrapper>
);

export const CrownIcon = ({ className, onClick }: { className?: string, onClick?: () => void }) => (
    <IconWrapper className={className} onClick={onClick}><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></IconWrapper>
);

export const SettingsIcon = ({ className, onClick }: { className?: string, onClick?: () => void }) => (
    <IconWrapper className={className} onClick={onClick}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></IconWrapper>
);

export const XIcon = ({ className, onClick }: { className?: string, onClick?: () => void }) => (
    <IconWrapper className={className} onClick={onClick}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></IconWrapper>
);

export const ChevronDownIcon = ({ className }: { className?: string }) => (
    <IconWrapper className={className}><polyline points="6 9 12 15 18 9"/></IconWrapper>
);