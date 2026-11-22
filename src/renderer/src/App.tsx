import { createEffect, createSignal, on, onCleanup, onMount, Show, type Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { SYSTEM_THEME } from '@shared/themes';
import { Sidebar, type Page } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { applyTheme } from './lib/format';
import { readView, writeView } from './lib/persisted';
import { Browser } from './pages/Browser';
import { Dashboard } from './pages/Dashboard';
import { Logs } from './pages/Logs';
import { Mounts } from './pages/Mounts';
import { Remotes } from './pages/Remotes';
import { Settings } from './pages/Settings';
import { Transfers } from './pages/Transfers';
import { createAppStore, type PageProps } from './store';

const PAGES: Record<Page, Component<PageProps>> = { Dashboard, Remotes, Mounts, Browser, Transfers, Logs, Settings };
const isPage = (value: unknown): value is Page => typeof value === 'string' && Object.hasOwn(PAGES, value);
const isScrollOffset = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function App() {
  const store = createAppStore();
  const [page, setPage] = createSignal(readView('page', 'Dashboard', isPage));
  const darkMedia = matchMedia('(prefers-color-scheme: dark)');
  const [prefersDark, setPrefersDark] = createSignal(darkMedia.matches);
  let scroller!: HTMLElement;
  let content!: HTMLDivElement;
  let restoreOffset: number | undefined;
  const collapsed = () => store.settings().general.sidebarCollapsed;
  const toggle = () => { if (store.ready()) void store.updateGeneral({ sidebarCollapsed: !collapsed() }); };

  createEffect(() => applyTheme(store.settings().general.theme || SYSTEM_THEME, prefersDark()));
  const maxScroll = () => Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const restoreScroll = () => {
    if (restoreOffset === undefined) return;
    const max = maxScroll();
    scroller.scrollTop = Math.min(restoreOffset, max);
    if (restoreOffset <= max) restoreOffset = undefined;
  };
  createEffect(on(page, (current) => {
    restoreOffset = readView(`scroll.${current}`, 0, isScrollOffset);
    restoreScroll();
  }));

  function rememberScroll(): void {
    // A restored page can grow after the first daemon response.
    if (restoreOffset !== undefined && scroller.scrollTop >= Math.min(restoreOffset, maxScroll())) return;
    restoreOffset = undefined;
    writeView(`scroll.${page()}`, scroller.scrollTop);
  }

  onMount(() => {
    const onTheme = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && !event.repeat && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        toggle();
      }
    };
    const observer = new ResizeObserver(restoreScroll);
    observer.observe(scroller);
    observer.observe(content);
    darkMedia.addEventListener('change', onTheme);
    window.addEventListener('keydown', onKey);
    onCleanup(() => {
      observer.disconnect();
      darkMedia.removeEventListener('change', onTheme);
      window.removeEventListener('keydown', onKey);
    });
  });

  function navigate(next: Page): void {
    if (next === page()) return;
    rememberScroll();
    writeView('page', setPage(next));
    scroller.focus();
  }

  return (
    <div class="shell">
      <TitleBar maximized={store.maximized()} stats={store.snapshot()?.stats} showTransfers={() => navigate('Transfers')} />
      <div class="shell-body">
        <Sidebar page={page()} collapsed={collapsed()} daemon={store.snapshot()?.daemon.state ?? 'stopped'}
          build={store.build()} mounts={store.snapshot()?.mounts.length ?? 0}
          jobs={store.snapshot()?.jobRuns.filter((run) => run.state === 'running').length ?? 0} navigate={navigate} toggle={toggle} />
        <main class="page" ref={scroller} tabindex="-1" aria-label={page()}
          onScroll={rememberScroll}>
          <div class="page-content" ref={content}>
            <Show when={store.error()}>{(message) => <p class="banner error" role="alert">{message()}</p>}</Show>
            <Show when={store.ready()} fallback={<Show when={!store.error()}><p role="status">Loading ludyRudy…</p></Show>}>
              <Show when={store.snapshot()?.dataError}>{(message) => <p class="banner" role="status">{message()}</p>}</Show>
              <Dynamic component={PAGES[page()]} store={store} navigate={navigate} />
            </Show>
          </div>
        </main>
      </div>
    </div>
  );
}
