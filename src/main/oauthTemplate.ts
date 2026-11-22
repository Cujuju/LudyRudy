import { APP_NAME } from '@shared/app';

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function sanitizeLabel(value: string): string {
  return value.replaceAll('{{', '').replaceAll('}}', '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch]!);
}

/** Builds a self-contained Go html/template for `rclone authorize --template`. */
export function renderOAuthTemplate(providerLabel: string): string {
  const provider = sanitizeLabel(providerLabel.trim() || 'Account');
  const app = sanitizeLabel(APP_NAME);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark light" />
  <title>{{ if .OK }}Authorized{{ else }}Authorization failed{{ end }} — ${app}</title>
  <style>
    :root {
      --bg: #08131d;
      --bg-glow: rgba(107, 232, 204, 0.085);
      --surface: #0d1d2b;
      --surface-node: #112638;
      --border: #1b364b;
      --border-strong: #2b526e;
      --ink: #edf6f9;
      --ink-secondary: #92aec2;
      --ink-muted: #64849a;
      --signal: #6be8cc;
      --signal-dim: rgba(107, 232, 204, 0.13);
      --signal-border: rgba(107, 232, 204, 0.45);
      --signal-rail: rgba(107, 232, 204, 0.55);
      --font-sans: 'Segoe UI Variable Display', 'Segoe UI', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      --font-mono: 'SF Mono', Consolas, 'Liberation Mono', ui-monospace, monospace;
      --radius-node: 8px;
      --radius-btn: 7px;
    }

    body[data-state='error'] {
      --bg-glow: rgba(239, 68, 68, 0.09);
      --signal: #f87171;
      --signal-dim: rgba(239, 68, 68, 0.14);
      --signal-border: rgba(239, 68, 68, 0.45);
      --signal-rail: rgba(239, 68, 68, 0.45);
    }

    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f1f5f8;
        --bg-glow: rgba(13, 138, 114, 0.07);
        --surface: #ffffff;
        --surface-node: #f7fafc;
        --border: #d2dfe8;
        --border-strong: #adc3d2;
        --ink: #0d2233;
        --ink-secondary: #415c70;
        --ink-muted: #658094;
        --signal: #0d8a72;
        --signal-dim: rgba(13, 138, 114, 0.1);
        --signal-border: rgba(13, 138, 114, 0.38);
        --signal-rail: rgba(13, 138, 114, 0.45);
      }

      body[data-state='error'] {
        --bg-glow: rgba(220, 38, 38, 0.07);
        --signal: #dc2626;
        --signal-dim: rgba(220, 38, 38, 0.1);
        --signal-border: rgba(220, 38, 38, 0.38);
        --signal-rail: rgba(220, 38, 38, 0.42);
      }
    }

    *, *::before, *::after { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }

    body {
      font-family: var(--font-sans);
      font-size: 15px;
      line-height: 1.55;
      color: var(--ink);
      background: radial-gradient(640px 340px at 50% 24%, var(--bg-glow), transparent 72%), var(--bg);
      display: grid;
      place-items: center;
      padding: clamp(20px, 5vw, 48px);
      -webkit-font-smoothing: antialiased;
    }

    .sheet { width: 100%; max-width: 560px; display: grid; gap: 30px; }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--ink-secondary);
      font-size: 14px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }

    .brand-mark { width: 22px; height: 22px; display: block; }

    .conduit-stage {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px 22px;
    }

    .conduit {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 54px auto 54px minmax(0, 1fr);
      align-items: center;
    }

    .node {
      display: grid;
      gap: 2px;
      min-width: 0;
      padding: 12px 14px;
      background: var(--surface-node);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-node);
    }

    .node-name {
      font-size: 14px;
      font-weight: 620;
      color: var(--ink);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .node-sub {
      font-size: 12px;
      color: var(--ink-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .node-sub.mono {
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 11.5px;
    }

    .rail { position: relative; height: 1.5px; background: var(--signal-rail); }

    .rail::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 50%;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      background: var(--signal);
    }

    .rail::before {
      content: '';
      position: absolute;
      inset: -1px 0;
      background: linear-gradient(90deg, transparent, var(--signal), transparent);
      opacity: 0;
      animation: signal-sweep 900ms cubic-bezier(0.22, 1, 0.36, 1) 120ms 1;
    }

    .rail-right::before { animation-delay: 320ms; }

    .shield-hub {
      width: 58px;
      height: 58px;
      display: grid;
      place-items: center;
      border-radius: 14px;
      background: var(--signal-dim);
      border: 1px solid var(--signal-border);
      box-shadow: 0 0 24px -6px var(--signal-dim);
    }

    .shield-hub svg { width: 34px; height: 34px; display: block; }

    .copy { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
    .copy-text { display: grid; gap: 6px; min-width: 0; }

    h1 {
      margin: 0;
      font-size: clamp(23px, 4vw, 28px);
      line-height: 1.2;
      font-weight: 660;
      letter-spacing: -0.025em;
      color: var(--ink);
    }

    .lead { margin: 0; color: var(--ink-secondary); font-size: 15px; line-height: 1.5; }
    .lead a { color: var(--signal); }

    .actions { display: grid; justify-items: end; gap: 8px; flex-shrink: 0; padding-top: 2px; }

    .btn-close {
      appearance: none;
      font: inherit;
      font-size: 14px;
      font-weight: 600;
      color: var(--ink);
      background: var(--surface);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-btn);
      padding: 9px 16px;
      white-space: nowrap;
      cursor: pointer;
      transition: border-color 140ms ease, background-color 140ms ease;
    }

    .btn-close:hover { border-color: var(--signal-border); background: var(--signal-dim); }
    .btn-close:focus-visible { outline: 2px solid var(--signal); outline-offset: 2px; }

    .hint { font-size: 12.5px; color: var(--ink-muted); text-align: right; }
    .hint:empty { display: none; }

    .hint kbd {
      font-family: var(--font-mono);
      font-size: 12px;
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid var(--border-strong);
      background: var(--surface);
      color: var(--ink-secondary);
    }

    .receipt {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding-top: 18px;
      border-top: 1px solid var(--border);
      font-size: 12.5px;
      color: var(--ink-muted);
    }

    .receipt-status { display: inline-flex; align-items: center; gap: 8px; }
    .receipt-endpoint { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 12px; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--signal); flex-shrink: 0; }

    @keyframes signal-sweep {
      0% { transform: translateX(-60%); opacity: 0; }
      40% { opacity: 1; }
      100% { transform: translateX(60%); opacity: 0; }
    }

    @media (prefers-reduced-motion: reduce) {
      .rail::before { animation: none; display: none; }
    }

    @media (max-width: 520px) {
      .conduit { grid-template-columns: 1fr; justify-items: stretch; }
      .rail { width: 1.5px; height: 22px; justify-self: center; }
      .rail::before { display: none; }
      .shield-hub { justify-self: center; }
      .copy { flex-direction: column; align-items: flex-start; }
      .actions { justify-items: start; }
      .hint { text-align: left; }
      .receipt { flex-direction: column; align-items: flex-start; }
    }
  </style>
</head>
<body data-state="{{ if .OK }}ok{{ else }}error{{ end }}">
  <main class="sheet">
    <header class="brand">
      <svg class="brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect width="32" height="32" rx="7.5" fill="#12364d" />
        <path d="M16 6.2L24.2 9.4V16.2C24.2 21.1 20.7 25.1 16 26.8C11.3 25.1 7.8 21.1 7.8 16.2V9.4L16 6.2Z"
              stroke="#6be8cc" stroke-width="2" stroke-linejoin="round" />
        <path d="M12.2 19.6H20.1C21.3 19.6 22.2 18.7 22.2 17.6C22.2 16.5 21.4 15.7 20.3 15.6C19.9 13.7 18.2 12.4 16.2 12.4C14.4 12.4 12.9 13.5 12.3 15.1C11 15.3 10 16.4 10 17.7C10 18.8 11 19.6 12.2 19.6Z"
              fill="#edf6f9" />
      </svg>
      <span>${app}</span>
    </header>

    <section class="conduit-stage" aria-label="Authorization handoff">
      <div class="conduit">
        <div class="node">
          <span class="node-name">${provider}</span>
          <span class="node-sub">{{ if .OK }}Verified{{ else }}Not authorized{{ end }}</span>
        </div>

        <div class="rail rail-left" aria-hidden="true"></div>

        <div class="shield-hub" aria-hidden="true">
          <svg viewBox="0 0 36 36" fill="none">
            <path d="M18 3.5L30.5 8.2V17.6C30.5 24.8 25.2 30.6 18 33C10.8 30.6 5.5 24.8 5.5 17.6V8.2L18 3.5Z"
                  stroke="var(--signal)" stroke-width="2.2" stroke-linejoin="round" />
            {{ if .OK }}
            <path d="M12.6 18.2L16.3 21.9L23.8 14.4"
                  stroke="var(--signal)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
            {{ else }}
            <path d="M13.5 13.5L22.5 22.5M22.5 13.5L13.5 22.5"
                  stroke="var(--signal)" stroke-width="2.4" stroke-linecap="round" />
            {{ end }}
          </svg>
        </div>

        <div class="rail rail-right" aria-hidden="true"></div>

        <div class="node">
          <span class="node-name">${app}</span>
          <span class="node-sub mono" id="node-host">127.0.0.1</span>
        </div>
      </div>
    </section>

    <section class="copy">
      <div class="copy-text">
        {{ if .OK }}
        <h1>${provider} connected.</h1>
        <p class="lead">Return to ${app} to finish setup.</p>
        {{ else }}
        <h1>${provider} authorization failed.</h1>
        <p class="lead">
          {{ if .Description }}{{ .Description }}{{ else if .Name }}{{ .Name }}{{ else }}Return to ${app} and try again.{{ end }}
          {{ if .HelpURL }}<a href="{{ .HelpURL }}">Help</a>{{ end }}
        </p>
        {{ end }}
      </div>

      <div class="actions">
        <button class="btn-close" type="button" id="close-tab">Close tab</button>
        <span class="hint" id="close-hint" aria-live="polite"></span>
      </div>
    </section>

    <footer class="receipt">
      <span class="receipt-status">
        <span class="dot" aria-hidden="true"></span>
        Local loopback
      </span>
      <span class="receipt-endpoint" id="receipt-endpoint">127.0.0.1:53682</span>
    </footer>
  </main>

  <script>
    const host = window.location.host;
    if (host) {
      document.getElementById('receipt-endpoint').textContent = host;
      document.getElementById('node-host').textContent = window.location.hostname || '127.0.0.1';
    }
    const button = document.getElementById('close-tab');
    const hint = document.getElementById('close-hint');
    const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
    button.addEventListener('click', () => {
      window.close();
      setTimeout(() => {
        hint.innerHTML = isMac
          ? 'Press <kbd>⌘W</kbd> to close.'
          : 'Press <kbd>Ctrl+W</kbd> to close.';
      }, 150);
    });
  </script>
</body>
</html>
`;
}
