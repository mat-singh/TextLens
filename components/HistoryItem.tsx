
import React from 'react';
import { ExtractionResult } from '../types';

interface HistoryItemProps {
  result: ExtractionResult;
  onCopy: (text: string) => void;
  onDelete: (id: string) => void;
}

export const HistoryItem: React.FC<HistoryItemProps> = ({ result, onCopy, onDelete }) => {
  return (
    <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700 shadow-xl mb-4">
      <div className="flex p-3 gap-3">
        <img 
          src={result.previewUrl} 
          alt="Preview" 
          className="w-20 h-20 object-cover rounded-lg border border-slate-600"
        />
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start mb-1">
            <span className="text-xs text-slate-400">
              {new Date(result.timestamp).toLocaleTimeString()}
            </span>
            <button 
              onClick={() => onDelete(result.id)}
              className="text-slate-500 hover:text-red-400 transition-colors"
            >
              <i className="lucide-trash-2 w-4 h-4"></i>
            </button>
          </div>
          <p className="text-sm line-clamp-2 text-slate-200">
            {result.text}
          </p>
        </div>
      </div>
      <div className="flex border-t border-slate-700">
        <button 
          onClick={() => onCopy(result.text)}
          className="flex-1 py-2 text-sm font-medium text-blue-400 hover:bg-slate-700/50 transition-colors flex items-center justify-center gap-2"
        >
          <i className="lucide-copy w-4 h-4"></i>
          Copy Text
        </button>
      </div>
    </div>
  );
};
