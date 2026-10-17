# PIW Nailo Launcher

Launcher experimental para [PokeIdle World](https://poke.idleworld.online/play), adaptado do projeto PIO Nailo.

## Objetivo

Executar múltiplas contas com consumo de memória menor que uma implementação baseada em Electron, preservando a arquitetura nativa **Rust + Tauri 2 + WebView2** e os recursos de gerenciamento de contas/headless.

> **Estado:** adaptação inicial. A compatibilidade com o servidor, o login, as funções de jogo e o uso de quatro contas ainda precisam ser testados. Não há medição de consumo de RAM validada.

## Código-fonte

O projeto adaptado deve ser enviado preservando a estrutura de `rust-migration/` na raiz do repositório, especialmente:

- `rust-migration/src-tauri/` — backend Rust/Tauri;
- `rust-migration/ui/` — interface;
- `rust-migration/Abrir PIO Rust.bat` — compilação e abertura no Windows.

O código-fonte original foi entregue em arquivo ZIP na conversa de desenvolvimento; **o ZIP não é uma versão executável já compilada**.

## Pré-requisitos (Windows)

- Rust e Cargo, com toolchain MSVC;
- Microsoft C++ Build Tools / SDK necessários ao Tauri;
- WebView2 Runtime.

A partir da pasta `rust-migration/src-tauri`, executar `cargo build`. O atalho `Abrir PIO Rust.bat` faz isso automaticamente e tenta abrir o binário de debug.

## Atenção

Este é um projeto independente, não oficial. Não publique `accounts.enc`, credenciais, arquivos `.env`, tokens, logs de sessão, nem pastas `target/` e `node_modules/`. Respeite a licença e os créditos do projeto original.
