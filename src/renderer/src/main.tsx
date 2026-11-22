import { render } from 'solid-js/web';
import { SYSTEM_THEME } from '@shared/themes';
import { setHourCycle } from '@shared/timeFormat';
import { App } from './App';
import { applyTheme } from './lib/format';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/pages.css';
import './styles/theme-picker.css';

setHourCycle(window.api.hourCycle);
applyTheme(SYSTEM_THEME, matchMedia('(prefers-color-scheme: dark)').matches);
render(() => <App />, document.getElementById('root')!);
