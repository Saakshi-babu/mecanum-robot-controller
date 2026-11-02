import { useStore } from './hooks/useStore';
import { useHashRoute } from './hooks/useHashRoute';
import { useKeyboardControl } from './hooks/useKeyboardControl';
import { Shell } from './components/Shell';
import { Overview } from './pages/Overview';
import { Controller } from './pages/Controller';
import { Dashboard } from './pages/Dashboard';
import { Localization } from './pages/Localization';
import { Events } from './pages/Events';
import { Settings } from './pages/Settings';

export function App() {
  const store = useStore();
  const route = useHashRoute();
  const keys = useKeyboardControl(store);
  return (
    <Shell route={route} keysHeld={keys}>
      {route === 'overview' && <Overview />}
      {route === 'controller' && <Controller />}
      {route === 'dashboard' && <Dashboard />}
      {route === 'localization' && <Localization />}
      {route === 'events' && <Events />}
      {route === 'settings' && <Settings />}
    </Shell>
  );
}
