document.getElementById('exportBtn').addEventListener('click', async () => {
  const status = document.getElementById('status');
  status.innerText = 'Extraindo e tratando conteúdo...';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    // Injeta a função de extração na página ativa
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractSanitizedPageContent
    });

    if (!result || !result.html.trim()) {
      status.innerText = 'Erro: Conteúdo principal não encontrado.';
      return;
    }

    status.innerText = 'Baixando imagens e convertendo para Markdown...';

    const zip = new JSZip();
    const imagesFolder = zip.folder("images");
    let htmlContent = result.html;

    // Redireciona os links das imagens para a pasta /images do ZIP
    for (const img of result.images) {
      imagesFolder.file(img.filename, img.data, { base64: true });
      const escapedUrl = escapeRegExp(img.originalSrc);
      const regex = new RegExp(escapedUrl, 'g');
      htmlContent = htmlContent.replace(regex, `images/${img.filename}`);
    }

    // Instancia o conversor HTML -> Markdown
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-'
    });

    // REGRA 1: Preserva e limpa as tags <details> e <summary>
    turndownService.addRule('detailsSummary', {
      filter: function (node) {
        return node.nodeName === 'DETAILS' || node.nodeName === 'SUMMARY';
      },
      replacement: function (content, node) {
        if (node.nodeName === 'DETAILS') {
          const isOpen = node.hasAttribute('open') ? ' open' : '';
          return `\n\n<details${isOpen}>\n${content.trim()}\n</details>\n\n`;
        }
        if (node.nodeName === 'SUMMARY') {
          const cleanText = content.replace(/\*/g, '').trim();
          return `<summary>${cleanText}</summary>\n\n`;
        }
        return content;
      }
    });

    // REGRA 2: Ajusta a largura máxima das imagens (400px)
    turndownService.addRule('compactImages', {
      filter: 'img',
      replacement: function (content, node) {
        const src = node.getAttribute('src');
        const alt = node.getAttribute('alt') || 'imagem';
        if (!src) return '';
        return `\n\n<img src="${src}" alt="${alt}" width="400" />\n\n`;
      }
    });

    // REGRA 3: Converte elementos <pre data-lang="..."> em blocos de código com sintaxe
    turndownService.addRule('fencedCodeBlocks', {
      filter: function (node) {
        return node.nodeName === 'PRE';
      },
      replacement: function (content, node) {
        const codeElement = node.querySelector('code') || node;
        const lang = node.getAttribute('data-lang') || codeElement.getAttribute('data-lang') || '';
        
        let text = codeElement.textContent || '';
        text = text.replace(/\u200B/g, '').trim();

        return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
      }
    });

    // Executa a conversão base para Markdown
    let baseMarkdown = turndownService.turndown(htmlContent);

    // Garante que o Título H1 seja adicionado no topo do documento
    if (result.mainTitle) {
      const cleanTitle = result.mainTitle.replace(/[\n\r]+/g, ' ').trim();
      baseMarkdown = baseMarkdown.replace(new RegExp(`^#+\\s*${escapeRegExp(cleanTitle)}`, 'i'), '').trim();
      baseMarkdown = `# ${cleanTitle}\n\n` + baseMarkdown;
    }

    baseMarkdown = baseMarkdown.replace(/\n{3,}/g, '\n\n').trim();

    const pageUrl = result.originalUrl || tab.url;
    const footer = `\n\n---\n\n> **Fonte original:** [${pageUrl}](${pageUrl})\n`;
    
    // Anexa o footer ao markdown base original
    baseMarkdown += footer;

    // --- LÓGICA DE DETECÇÃO DE IDIOMA E TRADUÇÃO ÚNICA ---
    const pageLang = (result.pageLang || 'en').toLowerCase();
    const isPortuguese = pageLang.startsWith('pt');

    if (isPortuguese) {
      // O site original é PT-BR
      zip.file("documentation-pt.md", baseMarkdown);
      
      status.innerText = 'Traduzindo para Inglês (en)...';
      const markdownEn = await translateMarkdownSafely(baseMarkdown, 'en');
      zip.file("documentation-en.md", markdownEn);
    } else {
      // O site original é EN (ou outro)
      zip.file("documentation-en.md", baseMarkdown);
      
      status.innerText = 'Traduzindo para Português (pt-br)...';
      const markdownPt = await translateMarkdownSafely(baseMarkdown, 'pt');
      zip.file("documentation-pt.md", markdownPt);
    }

    status.innerText = 'Gerando arquivo .ZIP...';

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const downloadUrl = URL.createObjectURL(zipBlob);

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `${result.slug}.zip`;
    a.click();

    status.innerText = 'Download concluído com sucesso!';
  } catch (err) {
    console.error(err);
    status.innerText = 'Erro: ' + err.message;
  }
});

// ====================================================================
// SISTEMA DE TRADUÇÃO PROTEGIDA (Preserva Código, Tags HTML e Imagens)
// ====================================================================
async function translateMarkdownSafely(markdown, targetLang) {
  const placeholders = [];
  
  const regexesToProtect = [
    /```[\s\S]*?```/g,                        // Blocos de código Markdown
    /<img[^>]+>/g,                            // Tags de imagem HTML
    /<details[^>]*>[\s\S]*?<\/details>/g,     // Blocos HTML details
    /!\[[^\]]*\]\([^)]+\)/g                   // Imagens Markdown inline
  ];

  let protectedMarkdown = markdown;
  regexesToProtect.forEach(regex => {
    protectedMarkdown = protectedMarkdown.replace(regex, (match) => {
      const placeholder = `[[[PROTECTED_BLOCK_${placeholders.length}]]]`;
      placeholders.push(match);
      return placeholder;
    });
  });

  // Quebra por linhas em vez de grandes parágrafos
  const lines = protectedMarkdown.split('\n');
  const translatedLines = [];
  let textBatch = "";

  for (let line of lines) {
    // Se for uma linha protegida ou vazia, traduz o acumulado e insere a linha intacta
    if (!line.trim() || /^\[\[\[PROTECTED_BLOCK_\d+\]\]\]$/.test(line.trim())) {
      if (textBatch.trim()) {
        const translatedBatch = await callGoogleTranslateAPI(textBatch, targetLang);
        translatedLines.push(translatedBatch);
        textBatch = "";
      }
      translatedLines.push(line);
      continue;
    }

    // Se o lote acumular mais de 1000 caracteres, envia para a API
    if ((textBatch + "\n" + line).length > 1000) {
      const translatedBatch = await callGoogleTranslateAPI(textBatch, targetLang);
      translatedLines.push(translatedBatch);
      textBatch = line;
    } else {
      textBatch = textBatch ? textBatch + "\n" + line : line;
    }
  }

  // Traduz qualquer resto pendente
  if (textBatch.trim()) {
    const translatedBatch = await callGoogleTranslateAPI(textBatch, targetLang);
    translatedLines.push(translatedBatch);
  }

  let finalMarkdown = translatedLines.join('\n');

  // Restaura os blocos protegidos intactos
  placeholders.forEach((originalText, index) => {
    const placeholder = `[[[PROTECTED_BLOCK_${index}]]]`;
    finalMarkdown = finalMarkdown.replace(placeholder, originalText);
  });

  return finalMarkdown;
}

// Consome a API do Google Translate via POST (suporta textos longos sem quebrar URL)
async function callGoogleTranslateAPI(text, targetLang) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ q: text })
    });

    if (!response.ok) throw new Error('Falha na resposta da API');
    
    const data = await response.json();
    if (!data || !data[0]) return text;

    return data[0].map(item => item[0]).join('');
  } catch (e) {
    console.warn("Falha na chamada da API, mantendo texto original:", e);
    return text; // Em caso de falha de conexão, retorna o texto sem quebrar o ZIP
  }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ====================================================================
// FUNÇÃO INJETADA QUE RODA NA PÁGINA DENTRO DO CHROMIUM
// ====================================================================
async function extractSanitizedPageContent() {
  const originalUrl = window.location.href;
  const pageLang = document.documentElement.lang || 'en'; // Captura o idioma do HTML

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

  const gfgTabs = clone.querySelectorAll('gfg-tabs, .code-container, .responsive-tabs');
  
  gfgTabs.forEach(tabsContainer => {
    const wrapper = document.createElement('div');
    const panels = tabsContainer.querySelectorAll('gfg-panel, [role="tabpanel"], .tab-panel');
    const tabs = tabsContainer.querySelectorAll('gfg-tab, [role="tab"], .tab-link');

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
          summary.textContent = tabName || lang.toUpperCase();

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
      if (tabsContainer.parentNode) {
        tabsContainer.parentNode.replaceChild(wrapper, tabsContainer);
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

    if (!src || src.startsWith('data:')) {
      img.remove();
      continue;
    }

    if (seenImageSrcs.has(src)) {
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
    pageLang: pageLang // Retornando o idioma detectado
  };
}