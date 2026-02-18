
import React, { useEffect } from 'react';

interface ToastProps {
  message: string;
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed bottom-36 left-1/2 -translate-x-1/2 z-[150] bg-blue-600 text-white px-8 py-3 rounded-2xl shadow-[0_10px_30px_rgba(37,99,235,0.4)] font-black text-xs uppercase tracking-widest border border-white/20 animate-in fade-in slide-in-from-bottom-4 duration-300">
      {message}
    </div>
  );
};
