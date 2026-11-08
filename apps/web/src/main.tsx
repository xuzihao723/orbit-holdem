import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { createNetworkRuntime, NetworkProvider } from './app/NetworkProvider';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
const runtime = createNetworkRuntime();
createRoot(root).render(
  <NetworkProvider runtime={runtime}>
    <StrictMode>
      <App />
    </StrictMode>
  </NetworkProvider>,
);
