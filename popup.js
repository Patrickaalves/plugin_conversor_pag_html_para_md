document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('translateToggle');
  const serviceSelect = document.getElementById('preferredServiceSelect');

  // Carrega preferências salvas
  chrome.storage.local.get(['translateEnabled', 'preferredService'], (data) => {
    if (data.translateEnabled !== undefined) {
      toggle.checked = data.translateEnabled;
    }
    if (data.preferredService) {
      serviceSelect.value = data.preferredService;
    }
  });

  // Salva alterações
  toggle.addEventListener('change', () => {
    chrome.storage.local.set({ translateEnabled: toggle.checked });
  });

  serviceSelect.addEventListener('change', () => {
    chrome.storage.local.set({ preferredService: serviceSelect.value });
  });
});

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'updateProgressUI') {
    updateProgress(request.percent, request.statusMessage);
    if (request.percent === 100) {
      document.getElementById('exportBtn').disabled = false;
    }
  }
});

document.getElementById('exportBtn').addEventListener('click', async () => {
  const exportBtn = document.getElementById('exportBtn');
  const translateToggle = document.getElementById('translateToggle');
  const serviceSelect = document.getElementById('preferredServiceSelect');
  
  exportBtn.disabled = true;
  updateProgress(5, 'Extraindo conteúdo...');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractSanitizedPageContent
    });

    if (!result || !result.html.trim()) {
      updateProgress(0, 'Erro: Conteúdo não encontrado.');
      exportBtn.disabled = false;
      return;
    }

    updateProgress(15, 'Tratando imagens...');

    let htmlContent = result.html;
    for (const img of result.images) {
      const escapedUrl = escapeRegExp(img.originalSrc);
      const regex = new RegExp(escapedUrl, 'g');
      htmlContent = htmlContent.replace(regex, `images/${img.filename}`);
    }

    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-'
    });

    turndownService.addRule('detailsSummary', {
      filter: (node) => node.nodeName === 'DETAILS' || node.nodeName === 'SUMMARY',
      replacement: (content, node) => {
        if (node.nodeName === 'DETAILS') {
          const isOpen = node.hasAttribute('open') ? ' open' : '';
          return `\n\n<details${isOpen}>\n${content.trim()}\n</details>\n\n`;
        }
        if (node.nodeName === 'SUMMARY') {
          return `<summary>${content.replace(/\*/g, '').trim()}</summary>\n\n`;
        }
        return content;
      }
    });

    turndownService.addRule('compactImages', {
      filter: 'img',
      replacement: (content, node) => {
        const src = node.getAttribute('src');
        const alt = node.getAttribute('alt') || 'imagem';
        return src ? `\n\n<img src="${src}" alt="${alt}" width="400" />\n\n` : '';
      }
    });

    turndownService.addRule('fencedCodeBlocks', {
      filter: 'pre',
      replacement: (content, node) => {
        const codeElement = node.querySelector('code') || node;
        const lang = node.getAttribute('data-lang') || codeElement.getAttribute('data-lang') || '';
        let text = (codeElement.textContent || '').replace(/\u200B/g, '').trim();
        return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
      }
    });

    turndownService.addRule('tables', {
      filter: 'table',
      replacement: (content, node) => {
        const rows = Array.from(node.querySelectorAll('tr'));
        if (rows.length === 0) return '';
        let markdownTable = '\n\n';
        rows.forEach((row, rowIndex) => {
          const cells = Array.from(row.querySelectorAll('th, td'));
          const cellTexts = cells.map(cell => cell.textContent.replace(/[\n\r]+/g, ' ').trim());
          markdownTable += '| ' + cellTexts.join(' | ') + ' |\n';
          if (rowIndex === 0) {
            markdownTable += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
          }
        });
        return markdownTable + '\n\n';
      }
    });

    updateProgress(30, 'Convertendo para Markdown...');
    let baseMarkdown = turndownService.turndown(htmlContent);

    if (result.mainTitle) {
      const cleanTitle = result.mainTitle.replace(/[\n\r]+/g, ' ').trim();
      baseMarkdown = baseMarkdown.replace(new RegExp(`^#+\\s*${escapeRegExp(cleanTitle)}`, 'i'), '').trim();
      baseMarkdown = `# ${cleanTitle}\n\n` + baseMarkdown;
    }

    baseMarkdown = baseMarkdown.replace(/\n{3,}/g, '\n\n').trim();
    const pageUrl = result.originalUrl || tab.url;
    baseMarkdown += `\n\n---\n\n> **Fonte original:** [${pageUrl}](${pageUrl})\n`;

    chrome.runtime.sendMessage({
      action: 'startBackgroundExport',
      payload: {
        baseMarkdown: baseMarkdown,
        images: result.images,
        slug: result.slug,
        pageLang: result.pageLang,
        translateEnabled: translateToggle.checked,
        preferredService: serviceSelect.value
      }
    });

  } catch (err) {
    console.error(err);
    updateProgress(0, 'Erro: ' + err.message);
    exportBtn.disabled = false;
  }
});

function updateProgress(percent, statusMessage) {
  const container = document.getElementById('progressContainer');
  const bar = document.getElementById('progressBar');
  const text = document.getElementById('progressText');
  const status = document.getElementById('status');

  if (container) container.style.display = 'block';
  if (text) text.style.display = 'block';

  if (bar) bar.style.width = `${percent}%`;
  if (text) text.innerText = `${percent}%`;
  if (status) status.innerText = statusMessage;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}