import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StoreContext } from './hooks/useStore';
import { RobotStore } from './store/robotStore';
import './styles/app.css';

// One store for the whole app: every card, chart and export reads from it.
const store = new RobotStore();
store.start();
window.addEventListener('pagehide', () => store.dispose());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreContext.Provider value={store}>
      <App />
    </StoreContext.Provider>
  </StrictMode>,
);
