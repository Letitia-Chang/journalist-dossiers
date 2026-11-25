import { useEffect, useState } from 'react';
import axios from 'axios';
import { X } from 'lucide-react';
import { apiError, apiStatus } from '../lib/errors';

/**
 * Shows any request failure a page didn't handle itself. Event handlers here are async, so an
 * uncaught API error arrives as an unhandled rejection; without this the click just did nothing.
 */
export default function ErrorToast() {
  const [message, setMessage] = useState('');

  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      if (!axios.isAxiosError(e.reason)) return;
      e.preventDefault();
      if (apiStatus(e.reason) === 401) return; // the app is already returning to the sign-in page
      setMessage(apiError(e.reason, e.reason.response ? 'Something went wrong. Please try again.' : "Can't reach the server. Check your connection and try again."));
    };
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
  }, []);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(''), 8000);
    return () => clearTimeout(t);
  }, [message]);

  if (!message) return null;
  return (
    <div role="alert" className="fixed bottom-4 right-4 left-4 sm:left-auto z-50 sm:max-w-sm bg-rose-50 border border-rose-200 text-rose-800 text-sm rounded-lg shadow-lg px-4 py-3 flex items-start gap-3">
      <span className="flex-1">{message}</span>
      <button onClick={() => setMessage('')} aria-label="Dismiss" className="text-rose-400 hover:text-rose-700"><X className="w-4 h-4" /></button>
    </div>
  );
}
