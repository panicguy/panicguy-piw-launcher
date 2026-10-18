<div align="center">

<img src="docs/piw-launcher-logo.webp" width="320" alt="Poke Idle World — By KimJongDudu" />

<br />

# PIW Launcher — Multi-Contas

**Quatro treinadores, um só launcher.** ⚡

Projeto comunitário para o [**Poke Idle World**](https://poke.idleworld.online/), adaptado a partir de software de código aberto, com foco em **múltiplas contas, scripts e uso eficiente de recursos no Windows**.

![Windows](https://img.shields.io/badge/Windows-x64-087CD6?style=flat-square&logo=windows11&logoColor=white)
![Rust](https://img.shields.io/badge/backend-Rust-D97649?style=flat-square&logo=rust&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white)
![WebView2](https://img.shields.io/badge/engine-WebView2-7952D7?style=flat-square)
![Contas](https://img.shields.io/badge/contas-at%C3%A9%204-A78BFA?style=flat-square)
![Versão](https://img.shields.io/badge/vers%C3%A3o-2.0.30-F3B64D?style=flat-square)
[![Licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-429C72?style=flat-square)](LICENSE)

[**Começar**](#-como-instalar) · [**Recursos**](#-o-que-tem-no-piw-launcher) · [**Modos**](#-modos-de-execução) · [**Scripts**](#-scripts-e-extensões) · [**Créditos**](#-créditos-e-licença)

</div>

---

## 👋 Bem-vindo, treinador!

O **PIW Launcher** reúne até **4 contas do Poke Idle World** em uma única janela, com **backend Rust**, interface **Tauri 2** e páginas executadas pelo **Microsoft Edge WebView2**.

A proposta é manter o gerenciamento das contas em um programa nativo, sem precisar iniciar quatro interfaces Electron. O consumo final de RAM e CPU ainda depende do jogo, dos WebViews, dos scripts e do modo escolhido.

> 🚧 **Projeto em desenvolvimento:** funcionalidades herdadas do projeto original ainda estão sendo adaptadas para as regras e protocolos do **PIW**. Recursos experimentais podem exigir ajustes e testes.

## ✨ O que tem no PIW Launcher?

| Recurso | O que faz |
|:---|:---|
| 🧑‍🤝‍🧑 **Até 4 contas** | Painéis e perfis separados para os treinadores. |
| 🦀 **Rust + Tauri + WebView2** | Backend nativo e WebViews individuais para o jogo. |
| 🧩 **Scripts por URL** | Adicione arquivos JavaScript usando links do GitHub. |
| 🔄 **Atualizar script** | Verifique e baixe uma nova versão do script usando o botão **Atualizar**. |
| 💾 **Preferências salvas** | Mantém as configurações e o estado ativado/desativado dos scripts. |
| 🃏 **Modo Carta / Modo Leve** | Configurações gráficas do próprio PIW que podem aliviar a renderização. |
| 💤 **Headless** | Modo nativo de conexão sem manter o WebView2 do jogo aberto. |
| 📊 **Painéis e telemetria** | Informações de contas, caçadas e recursos disponíveis no launcher. |

## 🚀 Como instalar

**Plataforma principal:** Windows 64 bits.

1. Instale o [Git para Windows](https://git-scm.com/downloads/win), se ainda não tiver.
2. Clone o repositório pelo PowerShell:

   ```powershell
   git clone https://github.com/panicguy/panicguy-piw-launcher.git
   cd panicguy-piw-launcher
   ```

3. Execute o arquivo **`.bat` de inicialização** na raiz do projeto (o nome do arquivo ainda é legado).
4. Aguarde o preparo das dependências e a compilação inicial. Na primeira abertura, isso pode demorar e exigir permissões de instalação.
5. Cadastre suas contas e faça login no PIW. Se aparecer a verificação do Cloudflare, conclua-a manualmente.

### 🛠️ Requisitos

| Componente | Por quê? |
|:---|:---|
| **Rust + Cargo** | Compilar o launcher nativo. |
| **Microsoft C++ Build Tools / Windows SDK** | Ferramentas de compilação no Windows. |
| **Microsoft Edge WebView2 Runtime** | Exibir o jogo dentro dos painéis. |
| **Python / componentes auxiliares** | Usados por partes do fluxo de autenticação herdado do projeto original. |

O inicializador tenta preparar dependências ausentes. O **primeiro build pode baixar diversos pacotes** e consumir espaço em disco.

Se quiser apenas verificar/compilar o backend manualmente, use:

```powershell
cd rust-migration\src-tauri
cargo check
cargo build
```

> 💡 **Atualização do código:** feche o launcher, execute `git pull origin main` na pasta do repositório e depois abra novamente o `.bat` ou compile com `cargo build`. Um executável antigo não se atualiza sozinho.

## 🧭 Modos de execução

O launcher e o PIW têm configurações distintas. **Modo Carta e Modo Leve são opções gráficas do jogo**; o **Headless** é um modo de execução do launcher.

| Modo | Exibição do jogo | Scripts JavaScript na página |
|:---|:---|:---|
| 🟣 **Normal / Janelas** | WebView2 visível | ✅ Podem executar |
| 🃏 **Carta + Leve** | WebView2 com gráficos simplificados no PIW | ✅ Podem executar |
| 🔵 **Painel de batalha** | Interface resumida do launcher | ✅ Enquanto o WebView2 existir e estiver ativo |
| 🟢 **Headless puro** | WebView2 fechado; conexão nativa via Rust | ❌ Scripts que dependem da página não executam nesse modo |

**Atenção:** ao retornar do Headless para o jogo, o launcher tenta recriar o WebView2 e reinjetar os scripts habilitados. Esse retorno e a reconexão dos scripts ainda estão em validação.

### 📊 E o consumo de memória?

Rust e Tauri ajudam a reduzir a sobrecarga do launcher, mas **cada WebView2 pode usar memória de renderização e GPU**. O modo Leve/Carta pode reduzir a carga visual; o Headless tende a liberar recursos da página, mas não executa os mesmos scripts de navegador.

Ainda **não temos um benchmark padronizado** de RAM/CPU do PIW Launcher com quatro contas. Não seria correto usar aqui os números do launcher PIO original, pois são jogos e testes diferentes.

## 🧩 Scripts e extensões

Abra **🧩 Scripts** no launcher para instalar e gerenciar seus userscripts:

1. Cole o link GitHub do arquivo `.js` ou `.user.js`.
2. Adicione o script e escolha se deseja ativá-lo.
3. Para verificar alterações no código original, use o botão **Atualizar** ao lado do script.
4. Scripts adicionados por URL ficam separados dos presets internos.

Os arquivos instalados podem ter acesso à página e à sessão do jogo. **Use somente scripts de autores em quem você confia.** O download de atualizações não deve substituir silenciosamente um script em execução: revise mudanças relevantes e reinicie/recarregue o painel quando solicitado.

> **Compatibilidade:** um script aparecer como *ativado* não garante que seu WebSocket esteja conectado ou que suas rotinas estejam funcionando. Faça o teste dentro do jogo e consulte **🐞 Erros** em caso de falha.

## 🔬 Em adaptação

| Funcionalidade | Situação |
|:---|:---|
| ✅ **Multi-contas e login manual** | Base operacional; CAPTCHA pode ser solicitado pelo jogo. |
| ✅ **Scripts por link do GitHub** | Adição, ativação persistida e botão de atualização disponíveis. |
| 🧪 **Retorno Headless → WebView2** | Reinjeção e reconexão dos scripts em testes. |
| 🧪 **Despachar Contas** | Viagem para hunts do PIW em adaptação. |
| 🔎 **Bônus Twitch / Kick** | Regras de presença e integração ainda precisam de validação no PIW. |
| 🔎 **Otimização de memória** | Testes com Carta, Leve e Headless; sem números oficiais publicados. |

## 📁 Estrutura do projeto

```text
panicguy-piw-launcher/
├── *.bat                     # Inicializador do Windows
├── tools/                     # Scripts de preparação e atualização
├── rust-migration/
│   ├── src-tauri/             # Backend Rust/Tauri
│   ├── ui/                    # Interface, estilos e ponte WebView2
│   └── presets/               # Presets internos (JustPokédex)
├── docs/                      # Identidade e documentação
├── README.md
└── LICENSE
```

## 🔒 Seus dados e suas contas

O **PIW Launcher** mantém seus dados e perfis **separados** dos dados do projeto original. Por compatibilidade, o diretório local de dados ainda utiliza um nome técnico legado; não o renomeie manualmente.

Não publique arquivos de credenciais, cookies, tokens, sessões, perfis pessoais ou relatórios sem antes remover informações sensíveis. **Não apague essas pastas ao atualizar o código.**

## 🤝 Créditos e licença

Esta é uma **adaptação comunitária independente para Poke Idle World**, baseada no trabalho do **[PIO Rebosteio / PIO Nailo, de souonailo](https://github.com/souonailo/rebosteio-launcher-pokeidleio)**. A licença e os créditos originais são preservados.

- **Projeto original:** [souonailo/rebosteio-launcher-pokeidleio](https://github.com/souonailo/rebosteio-launcher-pokeidleio).
- **Adaptação PIW:** [panicguy/panicguy-piw-launcher](https://github.com/panicguy/panicguy-piw-launcher).
- **Jogo:** [Poke Idle World](https://poke.idleworld.online/).
- **Licença do código:** [MIT](LICENSE).

O projeto não é oficial nem afiliado à equipe do jogo. Marcas e conteúdo do jogo pertencem aos respectivos titulares.

---

## 💜 Bora melhorar juntos?

Encontrou um problema ou tem uma sugestão? [**Abra uma issue**](https://github.com/panicguy/panicguy-piw-launcher/issues) e conte quais contas/modos estavam ativos e como reproduzir — sem incluir credenciais ou tokens.

<div align="center">

### 🎮 Boa caçada, treinador!

**PIW Launcher · By KimJongDudu**

<sub>Feito para a comunidade do Poke Idle World.</sub>

</div>
