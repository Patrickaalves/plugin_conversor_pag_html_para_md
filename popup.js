document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('translateToggle');

  // Carrega a preferência salva no storage (padrão: true)
  chrome.storage.local.get(['translateEnabled'], (data) => {
    if (data.translateEnabled !== undefined) {
      toggle.checked = data.translateEnabled;
    }
  });

  // Salva a alteração do toggle no storage
  toggle.addEventListener('change', () => {
    chrome.storage.local.set({ translateEnabled: toggle.checked });
  });
});

// Listener para receber as atualizações de progresso do background
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

    // Envia os dados para o background.js iniciar a tarefa pesada de tradução e download
    chrome.runtime.sendMessage({
      action: 'startBackgroundExport',
      payload: {
        baseMarkdown: baseMarkdown,
        images: result.images,
        slug: result.slug,
        pageLang: result.pageLang,
        translateEnabled: translateToggle.checked
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

async function extractSanitizedPageContent() {
  const originalUrl = window.location.href;
  const pageLang = document.documentElement.lang || 'en';

  const h1 = document.querySelector('h1') || 
             document.querySelector('.ArticleHeader_article-title__futDC') || 
             document.querySelector('.entry-title');
  const mainTitle = h1 ? h1.innerText : document.title;

  const contentSelectors = [
    '.MainArticleContent_articleMainContentCss__b_1_R',
    'article',
    '.article-body',
    '.entry-content',
    '.text',
    'main'
  ];

  let mainContainer = null;
  for (const selector of contentSelectors) {
    const el = document.querySelector(selector);
    if (el) {
      mainContainer = el;
      break;
    }
  }

  if (!mainContainer) mainContainer = document.body;
  const clone = mainContainer.cloneNode(true);

  const originalGfgTabs = mainContainer.querySelectorAll('gfg-tabs, .code-container, .responsive-tabs');
  const clonedGfgTabs = clone.querySelectorAll('gfg-tabs, .code-container, .responsive-tabs');

  originalGfgTabs.forEach((origTabsContainer, index) => {
    const targetCloneContainer = clonedGfgTabs[index];
    if (!targetCloneContainer) return;

    let panels = Array.from(origTabsContainer.querySelectorAll('gfg-panel, [role="tabpanel"], .tab-panel'));
    let tabs = Array.from(origTabsContainer.querySelectorAll('gfg-tab, [role="tab"], .tab-link'));

    if (origTabsContainer.shadowRoot) {
      const shadowPanels = Array.from(origTabsContainer.shadowRoot.querySelectorAll('gfg-panel, [role="tabpanel"], .tab-panel'));
      const shadowTabs = Array.from(origTabsContainer.shadowRoot.querySelectorAll('gfg-tab, [role="tab"], .tab-link'));
      if (shadowPanels.length > 0) panels = shadowPanels;
      if (shadowTabs.length > 0) tabs = shadowTabs;
    }

    const wrapper = document.createElement('div');

    if (panels.length > 0) {
      panels.forEach((panel, idx) => {
        let lang = panel.getAttribute('data-code-lang') || '';
        let tabName = tabs[idx] ? tabs[idx].textContent.trim() : lang;

        if (!lang && tabName) {
          lang = tabName.toLowerCase()
            .replace('c++', 'cpp')
            .replace('c#', 'csharp')
            .replace('javascript', 'javascript');
        }

        const preTag = panel.querySelector('pre');
        const codeText = preTag ? preTag.textContent : panel.textContent;

        if (codeText && codeText.trim()) {
          const details = document.createElement('details');
          if (idx === 0) details.setAttribute('open', '');

          const summary = document.createElement('summary');
          summary.textContent = tabName || lang.toUpperCase() || 'CÓDIGO';

          const newPre = document.createElement('pre');
          newPre.setAttribute('data-lang', lang);

          const newCode = document.createElement('code');
          newCode.setAttribute('data-lang', lang);
          newCode.textContent = codeText.trim();

          newPre.appendChild(newCode);
          details.appendChild(summary);
          details.appendChild(newPre);
          wrapper.appendChild(details);
        }
      });

      if (targetCloneContainer.parentNode) {
        targetCloneContainer.parentNode.replaceChild(wrapper, targetCloneContainer);
      }
    }
  });

  const junkSelectors = [
    'header', 'footer', 'nav', 'aside',
    '.gfg-header', '.navigation-bar', '.sidebar',
    '.author-details', '.author-info', '[class*="author"]',
    '.comments', '.related-posts', '.social-share',
    '.ad-unit', '.adsbygoogle', '[class*="ad-"]',
    'script', 'style', 'iframe', 'button', 'input', 'form', 'svg',
    '.CodeMirror', '.copy-code-button', '.editor-buttons',
    '.gfg-preview-carousel-toolbar', '.gfg-preview-carousel-index-count'
  ];

  junkSelectors.forEach(selector => {
    clone.querySelectorAll(selector).forEach(el => el.remove());
  });

  clone.querySelectorAll('img.bg, .gfg-preview-carousel-img.bg, img[class*="bg"]').forEach(el => el.remove());

  const imgElements = Array.from(clone.querySelectorAll('img'));
  const images = [];
  const seenImageSrcs = new Set();

  for (let i = 0; i < imgElements.length; i++) {
    const img = imgElements[i];
    const src = img.src || img.getAttribute('data-src');

    if (!src || src.startsWith('data:') || seenImageSrcs.has(src)) {
      img.remove();
      continue;
    }

    const srcLower = src.toLowerCase();
    const isJunkImg = srcLower.includes('avatar') || 
                      srcLower.includes('logo') || 
                      srcLower.includes('icon') || 
                      srcLower.includes('profile');

    const width = img.naturalWidth || img.width || 0;
    const height = img.naturalHeight || img.height || 0;

    if (isJunkImg || (width > 0 && width < 60) || (height > 0 && height < 60)) {
      img.remove();
      continue;
    }

    seenImageSrcs.add(src);

    try {
      const response = await fetch(src);
      const blob = await response.blob();
      
      const mimeType = blob.type || 'image/png';
      let ext = mimeType.split('/')[1] || 'png';
      if (ext.includes('+')) ext = ext.split('+')[0];

      const filename = `image_${images.length + 1}.${ext}`;

      const base64Data = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      });

      images.push({
        originalSrc: src,
        filename: filename,
        data: base64Data
      });
      
      img.src = src;
    } catch (e) {
      console.warn('Erro ao baixar imagem:', src, e);
    }
  }

  const urlPaths = window.location.pathname.split('/').filter(Boolean);
  const slug = urlPaths[urlPaths.length - 1] || 'documentation';

  return {
    mainTitle: mainTitle,
    html: clone.innerHTML,
    images: images,
    slug: slug,
    originalUrl: originalUrl,
    pageLang: pageLang
  };
}