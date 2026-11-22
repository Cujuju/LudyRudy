import { render } from 'solid-js/web';
import '@cujuju/electron-notices/styles.css';
import { NoticeOverlay } from '@cujuju/electron-notices/renderer';
import { APP_NAME } from '@shared/app';

render(() => <NoticeOverlay bridge={window.notices} label={APP_NAME} />, document.getElementById('root')!);
