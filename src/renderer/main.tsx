import { Toast } from '@heroui/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    // Data comes from IPC, so it is never stale on focus; the main process
    // pushes changes (library:changed, spotify:statusChanged) instead.
    queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
  },
});

// DESIGN.md › Compact: let the on-screen keyboard overlay content and read
// its height from env(keyboard-inset-height) instead of resizing the page.
const vk = (
  navigator as Navigator & { virtualKeyboard?: { overlaysContent: boolean } }
).virtualKeyboard;
if (vk) vk.overlaysContent = true;

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toast.Provider placement="bottom end" />
      {import.meta.env.DEV && (
        <ReactQueryDevtools buttonPosition="bottom-left" />
      )}
    </QueryClientProvider>
  </StrictMode>,
);
