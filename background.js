// Importa o JSZip para rodar em segundo plano
importScripts('lib/jszip.min.js');

// Listener para receber a tarefa enviada pelo popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startBackgroundExport') {
    processAndExportDocument(request.payload);
    sendResponse({ started: true });
  }
});

// Processamento em segundo plano (independente do popup estar aberto ou fechado)
async function processAndExportDocument(payload) {
  const { baseMarkdown, images, slug, pageLang, translateEnabled } = payload;
  const isPortuguese = (pageLang || 'en').toLowerCase().startsWith('pt');

  const zip = new JSZip();
  const imagesFolder = zip.folder("images");

  // Adiciona as imagens no ZIP
  for (const img of images) {
    imagesFolder.file(img.filename, img.data, { base64: true });
  }

  if (translateEnabled) {
    if (isPortuguese) {
      zip.file("documentation-pt.md", baseMarkdown);
      
      const markdownEn = await translateMarkdownSafely(baseMarkdown, 'en', (percent) => {
        sendProgressUpdate(percent, `Traduzindo (EN)... ${percent}%`);
      });
      zip.file("documentation-en.md", markdownEn);
    } else {
      zip.file("documentation-en.md", baseMarkdown);
      
      const markdownPt = await translateMarkdownSafely(baseMarkdown, 'pt', (percent) => {
        sendProgressUpdate(percent, `Traduzindo (PT-BR)... ${percent}%`);
      });
      zip.file("documentation-pt.md", markdownPt);
    }
  } else {
    // Se a tradução estiver desativada, cria o arquivo com o sufixo correto
    const fileName = isPortuguese ? "documentation-pt.md" : "documentation-en.md";
    zip.file(fileName, baseMarkdown);
  }

  sendProgressUpdate(95, 'Gerando arquivo .ZIP...');

  // Gera o arquivo ZIP em Base64
  const base64Zip = await zip.generateAsync({ type: "base64" });
  const dataUrl = `data:application/zip;base64,${base64Zip}`;

  // Dispara o download nativo do Chrome
  chrome.downloads.download({
    url: dataUrl,
    filename: `${slug}.zip`,
    saveAs: false
  }, () => {
    sendProgressUpdate(100, 'Concluído com sucesso!');
  });
}

// Envia atualizações de progresso para o popup (se ele estiver aberto)
function sendProgressUpdate(percent, statusMessage) {
  chrome.runtime.sendMessage({
    action: 'updateProgressUI',
    percent: percent,
    statusMessage: statusMessage
  }).catch(() => {
    // Ignora erros caso o popup tenha sido fechado pelo usuário
  });
}

// TRADUÇÃO EM LOTES (Protege contra HTTP 429)
async function translateMarkdownSafely(markdown, targetLang, onProgress) {
  const map = new Map();
  let counter = 0;

  const regexesToProtect = [
    /<details[\s\S]*?<\/details>/gi,
    /```[\s\S]*?```/g,
    /<img[^>]+>/gi,
    /!\[[^\]]*\]\([^)]+\)/g,
    /\|[^\n]+\|\n\|[\s:-|-]+\|\n(\|[^\n]+\|\n?)*/g
  ];

  let protectedMarkdown = markdown;

  regexesToProtect.forEach(regex => {
    protectedMarkdown = protectedMarkdown.replace(regex, (match) => {
      const key = `XYZPROTECTEDBLOCK${counter}XYZ`;
      map.set(key, match);
      counter++;
      return `\n\n${key}\n\n`;
    });
  });

  const rawChunks = protectedMarkdown.split(/\n\s*\n/);
  const structuredChunks = [];
  const translatableIndexes = [];

  rawChunks.forEach((chunk) => {
    const trimmed = chunk.trim();
    if (!trimmed) {
      structuredChunks.push({ type: 'empty', text: '' });
      return;
    }

    let isProtected = map.has(trimmed);
    if (!isProtected) {
      for (let key of map.keys()) {
        if (trimmed.includes(key)) {
          isProtected = true;
          break;
        }
      }
    }

    if (isProtected) {
      structuredChunks.push({ type: 'protected', text: chunk });
    } else {
      structuredChunks.push({ type: 'text', text: chunk });
      translatableIndexes.push(structuredChunks.length - 1);
    }
  });

  const DELIMITER = "\n\n___SPLIT_SECTION___\n\n";
  const batches = [];
  let currentBatch = [];
  let currentLength = 0;

  for (let idx of translatableIndexes) {
    const text = structuredChunks[idx].text;
    if (currentLength + text.length > 2000 && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentLength = 0;
    }
    currentBatch.push({ idx, text });
    currentLength += text.length + DELIMITER.length;
  }
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  const totalBatches = batches.length;
  for (let b = 0; b < totalBatches; b++) {
    const batch = batches[b];
    const combinedText = batch.map(item => item.text).join(DELIMITER);

    if (onProgress) {
      onProgress(Math.round(((b + 1) / (totalBatches || 1)) * 100));
    }

    try {
      const translatedCombined = await callGoogleTranslateAPI(combinedText, targetLang);
      const translatedParts = translatedCombined.split(/___SPLIT_SECTION___|___ SPLIT_SECTION ___|___ SPLIT SECTION ___/i);

      batch.forEach((item, i) => {
        if (translatedParts[i] && translatedParts[i].trim()) {
          structuredChunks[item.idx].text = translatedParts[i].trim();
        }
      });
    } catch (e) {
      console.warn("Falha no lote de tradução, mantendo originais:", e);
    }

    if (b < totalBatches - 1) {
      await new Promise(r => setTimeout(r, 400));
    }
  }

  let finalMarkdown = structuredChunks.map(c => c.text).join('\n\n');

  map.forEach((originalContent, key) => {
    finalMarkdown = finalMarkdown.replace(new RegExp(key, 'g'), () => originalContent);
  });

  return finalMarkdown.replace(/\n{3,}/g, '\n\n').trim();
}

async function callGoogleTranslateAPI(text, targetLang) {
  if (!text || !text.trim()) return text;
  const encodedText = encodeURIComponent(text);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodedText}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ q: text })
    });
    if (!response.ok) return text;
    const data = await response.json();
    if (data && data[0] && Array.isArray(data[0])) {
      return data[0].map(item => (item && item[0]) ? item[0] : '').join('');
    }
    return text;
  } catch (e) {
    return text;
  }
}