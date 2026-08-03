# 🌐 Web Doc to Markdown Exporter

Uma extensão modular e resiliente para navegadores baseados no **Chromium** (Google Chrome, Microsoft Edge, Brave, Opera, etc.) que converte artigos e documentações da web em arquivos **Markdown (`.md`)** prontos para uso offline no VS Code, Obsidian ou GitHub, com suporte a **tradução automática híbrida (Google Translate + Docker LibreTranslate)**.

A extensão baixa automaticamente todas as imagens da página para uma pasta local, limpa anúncios e menus desnecessários, gerencia downloads em segundo plano (Service Worker) e entrega tudo compactado em um único arquivo `.zip`.

---

## ✨ Funcionalidades

* 📑 **Extração Inteligente de Conteúdo:** Captura o título e o corpo do artigo principal, removendo headers, footers, barras laterais, anúncios e comentários.
* 🖼️ **Download e Deduplicação de Imagens:** Baixa apenas as imagens relevantes da página (desprezando ícones e avatares), remove duplicatas e salva em uma pasta `images/` dentro do arquivo `.zip`.
* 📐 **Redimensionamento Automático de Imagens:** Define largura adequada para que o preview no VS Code ou Obsidian fique limpo e sem estouro de layout.
* 💻 **Suporte a Abas de Código (Multi-Linguagem):** Transforma abas de código (como as do GeeksforGeeks, incluindo suporte a Shadow DOM) em blocos retráteis HTML (`<details><summary>`), mantendo a formatação e destaque de sintaxe (` ```cpp `, ` ```java `, ` ```python `, etc.).
* 🌐 **Tradução Automática Híbrida & Inteligente:**
  * **Provedor Preferencial Selecionável:** Escolha na interface entre **Google Translate API** ou **Docker Local (LibreTranslate)**.
  * **Fallback Automático:** Se o provedor escolhido falhar (por limites como erro HTTP 429 no Google ou se o Docker estiver desligado), a extensão chaveia automaticamente para o provedor secundário.
  * **Processamento em Lotes por Array JSON:** Envia blocos de texto nativos sem corromper marcadores de parágrafo ou código.
  * **Sanitização de Markdown:** Limpa artefatos comuns de tradução NMT (espaçamentos em negritos `** texto **`, correções de títulos `# # #` para `###`, etc.).
  * **Proteção contra Falha Crítica:** Se nenhum provedor de tradução estiver disponível, o processo não corrompe o arquivo e gera o `.zip` contendo apenas a versão no idioma original.
* ⚡ **Processamento em Segundo Plano (Background Service Worker):** Todo o processo pesado de tradução, montagem de `.zip` e download roda via Service Worker. Você pode fechar a janela da extensão ou trocar de aba sem interromper o download.
* 🎛️ **Controle por Toggle & Persistência:** Opção de ativar/desativar a geração de tradução a qualquer momento, salvando suas preferências de uso no `chrome.storage.local`.
* 🔗 **Atribuição de Fonte:** Adiciona automaticamente um divisor e o link original da página no final do documento Markdown.

---

## 📁 Estrutura do Arquivo `.ZIP` Gerado

Após clicar para exportar, a extensão gera um arquivo `.zip` contendo a versão original e a traduzida (caso a tradução esteja ativada):

```text
nome-do-artigo.zip
 ├── images/
 │    ├── image_1.png
 │    └── image_2.webp
 ├── documentation-en.md
 └── documentation-pt.md
```

*(Caso a tradução esteja desativada ou ambos os provedores fiquem indisponíveis, apenas a versão original da página será incluída).*

---

## 🏗️ Arquitetura e Estrutura do Projeto

O código da extensão foi modularizado para separação clara de responsabilidades:

```text
web-to-markdown-extension/
 ├── manifest.json       # Configuração e permissões da extensão (Manifest V3)
 ├── popup.html          # Interface do usuário (Toggle de tradução, seleção de provedor, progresso)
 ├── popup.js            # Lógica da interface, envio de comandos e Turndown
 ├── background.js       # Service worker (Processamento em segundo plano e downloads)
 ├── translator.js       # Lógica de tradução (Arrays, Google API, Docker API, Fallback e Sanitização)
 ├── extractor.js        # Extração e limpeza do DOM da página web (suporte a Shadow DOM)
 └── lib/
      ├── turndown.js    # Conversor HTML para Markdown
      └── jszip.min.js   # Geração de arquivos .ZIP
```

---

## 🚀 Como Instalar a Extensão no Navegador

### 1. Pré-requisitos
Garanta que as bibliotecas de terceiros estejam salvas dentro da pasta `lib/` da extensão:
* **Turndown JS** (Salvo como `lib/turndown.js`)
* **JSZip** (Salvo como `lib/jszip.min.js`)

### 2. (Opcional) Subir o Container Docker para Tradução Local
Se você prefere traduzir de forma 100% offline, ilimitada e sem riscos de bloqueio HTTP 429 pelo Google, suba o container do **LibreTranslate**:

```bash
docker run -d -p 5000:5000 --name libretranslate libretranslate/libretranslate --load-only en,pt
```

### 3. Passo a Passo de Instalação na Extensão
1. Abra o seu navegador (Chrome, Edge, Brave, etc.).
2. Digite na barra de endereço: `chrome://extensions/`
3. No canto superior direito, ative a opção **Modo do desenvolvedor** (*Developer Mode*).
4. Clique no botão **Carregar sem compactação** (*Load unpacked*).
5. Selecione a pasta do projeto da extensão (`web-to-markdown-extension`).

---

## 📥 Como Exportar e Usar a Documentação

### Passo 1: Configurar e Exportar da Web
1. Acesse qualquer página de documentação ou artigo técnico (exemplo: GeeksforGeeks).
2. Clique no ícone da extensão no menu do navegador.
3. Configure suas preferências no popup:
   * **Gerar tradução:** Ative ou desative conforme desejado.
   * **Provedor preferencial:** Selecione **Google Translate** ou **Docker (Local)**.
4. Clique no botão **Exportar para .ZIP**.
5. O navegador iniciará o processamento em segundo plano e baixará o arquivo `.zip` (ex: `java-user-input-scanner-class.zip`).

---

## 💻 Como Importar no VS Code

1. Descompacte o arquivo `.zip` dentro da pasta do seu projeto ou repositório de estudos (ex: `/meu-projeto/java/`).
2. Abra o **VS Code**.
3. Abra a pasta onde você descompactou os arquivos (**File > Open Folder...**).
4. Abra o arquivo `documentation-pt.md` ou `documentation-en.md`.
5. Para visualizar a documentação formatada com as imagens locais e blocos retráteis:
   * Clique no ícone de **Visualização Lado a Lado** (*Open Preview to the Side*) no canto superior direito do editor.
   * Ou use o atalho: `Ctrl + K` e depois `V` (Windows/Linux) ou `Cmd + K` e depois `V` (Mac).

---

## 💎 Como Importar no Obsidian

1. Extraia o conteúdo do arquivo `.zip` baixado para dentro do seu **Cofre (Vault)** do Obsidian.
2. Certifique-se de manter os arquivos `.md` e a pasta `images/` no mesmo nível do diretório.
3. Abra o **Obsidian**.
4. Os arquivos `documentation-pt.md` e `documentation-en.md` aparecerão automaticamente no seu painel lateral.
5. Ao abrir os arquivos, as imagens e os blocos expansíveis de código funcionarão nativamente!

---

## 🧰 Tecnologias Utilizadas

* **JavaScript (ES6+)**
* **Chrome Extension Manifest V3** (Background Service Workers & Scripting API)
* **LibreTranslate (Docker)** — Servidor local de tradução neural (NMT).
* **Google Translate API** — Endpoint de tradução web em segundo plano.
* **Turndown** — Conversor de HTML para Markdown.
* **JSZip** — Biblioteca de criação de arquivos `.zip` em JavaScript.

---

## 📝 Licença

Este projeto é de código aberto e destinado a fins educacionais e de automação pessoal de documentações.