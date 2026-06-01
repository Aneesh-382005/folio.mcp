const WORKER_ROOT = 'https://folio-mcp.aneesh382005.workers.dev';
const TOOLS_ENDPOINT = `${WORKER_ROOT}/tools`;

const toolStatus = document.getElementById('tools-status');
const toolsGrid = document.getElementById('tools-grid');
const copyButtons = document.querySelectorAll('[data-copy-text]');
const tabButtons = document.querySelectorAll('[data-tab-target]');
const tabPanels = document.querySelectorAll('.tab-panel');

const tabsReadyClass = 'js-ready';

document.documentElement.classList.add(tabsReadyClass);

function formatExampleInput(exampleInput) {
  if (exampleInput == null) return null;
  if (typeof exampleInput === 'string') return exampleInput;
  return JSON.stringify(exampleInput, null, 2);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderTools(tools) {
  if (!tools.length) {
    toolsGrid.innerHTML = '<p class="fallback">No tools were returned by the Worker.</p>';
    return;
  }

  toolsGrid.innerHTML = tools
    .map((tool) => {
      const parameters = Array.isArray(tool.parameters) ? tool.parameters : [];
      const exampleInput = formatExampleInput(tool.exampleInput);

      return `
        <article class="tool-card">
          <h3>${escapeHtml(tool.title || tool.name)}</h3>
          <p class="tool-desc">${escapeHtml(tool.description || '')}</p>
          <div class="tool-meta">
            <div class="meta-block">
              <label>Returns</label>
              <p>${escapeHtml(tool.returns || '—')}</p>
            </div>
            ${
              parameters.length
                ? `
              <div class="meta-block">
                <label>Parameters</label>
                <ul>
                  ${parameters
                    .map((parameter) => `<li><strong>${escapeHtml(parameter.name)}</strong> — ${escapeHtml(parameter.description || '')}</li>`)
                    .join('')}
                </ul>
              </div>
            `
                : ''
            }
            ${
              exampleInput
                ? `
              <div class="meta-block">
                <label>Example input</label>
                <pre class="example-input"><code>${escapeHtml(exampleInput)}</code></pre>
              </div>
            `
                : ''
            }
          </div>
        </article>
      `;
    })
    .join('');
}

async function loadTools() {
  try {
    const response = await fetch(TOOLS_ENDPOINT, {
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    renderTools(data.tools || []);
    toolStatus.textContent = `${data.tools.length} tools loaded`;
  } catch (error) {
    toolStatus.textContent = 'Tools unavailable';
    toolsGrid.innerHTML = `
      <p class="fallback">
        The Worker tool catalog could not load right now. The page still works, and the tools will appear once the Worker responds.
      </p>
    `;
  }
}

function setCopyState(button, copied) {
  button.classList.toggle('is-copied', copied);
  const state = button.querySelector('.pill-state');
  if (state) {
    state.textContent = copied ? 'Copied' : 'Copy';
  } else {
    if (!button.dataset.originalLabel) {
      button.dataset.originalLabel = button.textContent || 'Copy';
    }
    button.textContent = copied ? 'Copied' : button.dataset.originalLabel;
  }
}

async function copyText(button, text) {
  try {
    await navigator.clipboard.writeText(text);
    setCopyState(button, true);
    window.clearTimeout(button._copyTimer);
    button._copyTimer = window.setTimeout(() => setCopyState(button, false), 1400);
  } catch {
    setCopyState(button, true);
    window.clearTimeout(button._copyTimer);
    button._copyTimer = window.setTimeout(() => setCopyState(button, false), 1400);
  }
}

copyButtons.forEach((button) => {
  button.addEventListener('click', () => {
    copyText(button, button.dataset.copyText || '');
  });
});

tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const targetId = button.dataset.tabTarget;
    const targetPanel = document.getElementById(targetId);

    tabButtons.forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });

    tabPanels.forEach((panel) => panel.classList.remove('is-active'));
    if (targetPanel) {
      targetPanel.classList.add('is-active');
    }
  });
});

loadTools();
